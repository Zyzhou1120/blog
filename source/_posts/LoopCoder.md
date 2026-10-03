---
title: LoopCoder
date: 2026-10-02
tags: []
categories:
  - - loop transformer
  - - 论文
priority: 2
---

> 前文：[Ouro](/blog/read/?post=Ouro.md)、[Huginn](/blog/read/?post=Huginn.md)。本篇介绍 [LoopCoder: Scaling Code Intelligence via Looped Language Models](https://aclanthology.org/2026.findings-acl.796/)，以 ACL 2026 版本为准。

前面我们已经让一组 Transformer Block 反复处理同一排向量。多走几轮，就能在参数基本不变的情况下增加计算深度。

那我们手里如果已经有一个训练好的代码模型，能不能直接把它改成一个循环循环结构，从而增强它的代码能力？


它使用约 40B 参数，使用 $80$ 层 transformer block，固定循环两轮。和 Ouro 学习“在哪一轮退出”的重点不同，这篇更关心：怎样把循环用到一个较大的代码模型上。

### Loopcoder 的结构

假设输入有 $n$ 个 token，每个 token 转成一个 $d$ 维列向量，拼成：

$$
E=[e_1,\ldots,e_n]\in\mathbb R^{d\times n}.
$$


- 第一轮从 $E$ 开始，把整组 Block 走一遍，得到：

$$
H^{(1)}=F_\theta^{(1)}(E).
$$

$H^{(1)}$ 还是一排 $d$ 维向量。同时，每一层把自己算出的 Key 和 Value 保存下来。

- 第二轮直接把第一轮最后的输出 \(H^{(1)}\) 作为输入。

假设我们聚焦于 $\ell$ 层、第 $a$ 个注意力头 (因为这里是多头注意力)、第 $i$ 个 token。这个位置送入门控头的第二轮 Query 记为 $q_{\ell,a,i}^{(2)}\in\mathbb R^{d_h}$。$K_{\ell,a}^{(1)},V_{\ell,a}^{(1)}$ 保存第一轮这个头在各位置的 Key 和 Value；$K_{\ell,a}^{(2)},V_{\ell,a}^{(2)}$ 则来自第二轮。

用当前这一个 Query 分别读取两份 KV，得到两个 $d_h$ 维输出向量，表示注意力：

$$
\begin{aligned}
o_{\ell,a,i}^{\mathrm g}
&=\operatorname{Attention}
\bigl(q_{\ell,a,i}^{(2)},K_{\ell,a}^{(1)},V_{\ell,a}^{(1)}\bigr),\\
o_{\ell,a,i}^{\mathrm l}
&=\operatorname{Attention}
\bigl(q_{\ell,a,i}^{(2)},K_{\ell,a}^{(2)},V_{\ell,a}^{(2)}\bigr).
\end{aligned}
$$

可以看出来式子相当于用本轮的 $q$ 分别和本轮的 $k,v$ 和上一轮的 $k,v$ 做交叉注意力。

上标 $\mathrm g,\mathrm l$ 分别表示 global、local 两条分支，即使不使用上一轮 $k,v$。模型在推理的时候使用一个 $g_{\ell,a,i}$，把两个向量加权起来：

$$
\begin{aligned}
o_{\ell,a,i}
&=g_{\ell,a,i}\,o_{\ell,a,i}^{\mathrm g}\\
&\quad +(1-g_{\ell,a,i})\,o_{\ell,a,i}^{\mathrm l}.
\end{aligned}
$$

和之前几节差不多，$g_{\ell,a,i}$ 由一个门控头训练得来。

$$
g_{\ell,a,i}
=\sigma\!\left(w_{\ell,a}^{\top}q_{\ell,a,i}^{(2)}+b_{\ell,a}\right),
\qquad
\sigma(s)=\frac{1}{1+e^{-s}}.
$$

依旧使用交叉熵来计算 loss：

$$
\mathcal L_{\mathrm{LM}}
=-\frac{1}{|\mathcal T|}\sum_{i\in\mathcal T}
\log p_{\theta,\phi}(x_{i+1}\mid x_{\le i}).
$$

---

### 应用

只学一些数据，学会语料接龙，离日常写代码还有一段距离。

比如一个函数中间空了一段，我们希望模型结合前后的代码把它补起来；一个项目出了 bug，我们希望它读报错、定位文件、做修改，再跑测试。这些都需要相应的训练数据。

mid-training 先在 32K 长度上适应推理和工具操作，再加入更长的 128K 数据，来训练代码能力。两阶段各约 300B token。

论文 Table 2 给出的主要数据量如下，单位为 B token：

| 数据类型 | 32K 阶段 | 128K 阶段 |
| --- | ---: | ---: |
| 推理问答：代码、数学、逻辑 | 175 | 65 |
| Agent 操作轨迹 | 10 | 110 |
| Commit 数据 | 5 | 35 |
| 文件级数据 | 35 | 5 |
| 仓库级数据 | 5 | 35 |
| 从前一阶段抽样的数据 | 70 | 50 |
| 合计 | 300 | 300 |


#### 补中间：FIM

把一段代码切成前缀 $P$、中间缺失部分 $M$ 和后缀 $S$：

$$
\text{原代码}=P+M+S.
$$

普通续写主要学习从左向右预测；Fill-In-the-Middle，简称 FIM，会把前缀和后缀都先给模型，再要求模型在后面接龙生成中间内容：

```text
<fim_prefix> P <fim_suffix> S <fim_middle> M
```

目标依旧可以写成交叉熵：

$$
\mathcal L_{\mathrm{FIM}}
=-\sum_{j=1}^{|M|}\log p_\theta(M_j\mid P,S,M_{<j}).
$$

- \(|M|\)：中间部分有多少个 token。
- \(M_j\)：中间部分第 \(j\) 个正确 token。
- \(M_{<j}\)：它前面的那些中间 token。
- \(p_\theta(\cdots)\)：给定前缀、后缀和前面的中间 token，模型给这个正确 token 分配的概率。




#### 后训练

后训练先做 SFT：给模型“题目＋正确解答”的示范。和前文训练方法一样，让它根据题目逐个预测答案中的 token，用交叉熵更新参数。

再进入竞赛代码的强化学习训练。**对于同一道题，模型采样生成 16 份候选回答，每份代码都运行这道题的同一组 20 个测试用例。** 先各自打分，再在这 16 份回答之间比较，最后更新模型参数。

把同一个题目输入给当前模型，分别采样 16 次，得到 $c_1,\ldots,c_{16}$。这里 $c_j$ 是第 $j$ 份候选回答，里面包含生成的代码，也可能包含解题过程。生成带有随机性，所以这些回答可能采用不同写法，也可能有重复。


对第 $j$ 份回答中的代码，第 $k$ 个测试通过记为 $v_k(c_j)=1$，不通过记为 $0$。奖励就是通过比例：

$$
r_j=r(c_j)=\frac{1}{20}\sum_{k=1}^{20}v_k(c_j).
$$

然后比较这 16 份回答，算出谁比同组平均表现好。


GRPO 根据组内相对表现构造优势值 $A_j$。采用常见的组内标准化写法：

$$
A_j=\frac{r_j-\bar r}{s_r+\epsilon}.
$$

$s_r$ 是这 16 个奖励的标准差，用来调整数值尺度；$\epsilon$ 是防止除以零的小量。


最后根据优势，更新生成这些回答的模型。

把题目记为 $x$，模型生成第 $j$ 份回答的概率记为 $p_\theta(c_j\mid x)$。为了说明更新方向，先看一个简化的策略梯度损失：

$$
\mathcal L_{\text{示意}}
=-\frac{1}{16}\sum_{j=1}^{16}
A_j\log p_\theta(c_j\mid x).
$$

优势为正，最小化损失会推动模型提高这份回答的生成概率；优势为负，则推动它降低这份回答的生成概率。

整份回答的对数概率，就是其中各个 token 的对数概率相加。设回答有 $T_j$ 个 token，第 $t$ 个记为 $c_{j,t}$，则：

$$
\log p_\theta(c_j\mid x)
=\sum_{t=1}^{T_j}
\log p_\theta(c_{j,t}\mid x,c_{j,<t}).
$$

---

以下是一些实验结果：

先看同一篇论文中，DenseCoder-40B-Instruct 与 LoopCoder-40B-Instruct 的对照。两者名义参数规模相近，后者使用两轮循环。

下表摘自 Table 3、5、6。增加量为百分点；Aider 使用表中的 Diff Pass@2，其他行按各表所报得分列出：

| 任务与指标 | DenseCoder | LoopCoder | 增加 |
| --- | ---: | ---: | ---: |
| SWE-bench Verified，修复问题成功率 | 72.4 | 76.2 | +3.8 |
| Terminal-Bench 2.0，任务成功率 | 25.0 | 33.0 | +8.0 |
| Aider-Polyglot，Diff Pass@2 | 62.4 | 68.9 | +6.5 |
| BigCodeBench Full，代码生成得分 | 44.9 | 49.9 | +5.0 |
| FullStackBench，全栈代码能力得分 | 62.3 | 68.3 | +6.0 |
| LiveCodeBench V6，代码生成得分 | 43.5 | 48.5 | +5.0 |

这些结果覆盖了生成代码、修改代码和与环境交互。它的提升不只体现在一道题能不能补出一个函数上。[论文 Table 3、5、6](https://aclanthology.org/2026.findings-acl.796.pdf#page=6)

不过，**这个比较不是同等计算量下的纯结构消融**。LoopCoder 多做了一轮计算，还有初始化、训练数据和后训练过程的共同作用。

Thinking 版本在代码推理上的结果更高。论文 Table 6 中：

| 模型 | CruxEval I-COT | CruxEval O-COT | LiveCodeBench V6 |
| --- | ---: | ---: | ---: |
| LoopCoder-40B-Instruct | 91.1 | 85.5 | 48.5 |
| LoopCoder-40B-Thinking | 98.5 | 99.4 | 81.1 |

### 参考资料

- [LoopCoder: Scaling Code Intelligence via Looped Language Models，ACL 2026](https://aclanthology.org/2026.findings-acl.796/)
- [ACL 版本论文全文](https://aclanthology.org/2026.findings-acl.796.pdf)
- [IQuest-Coder-V1 官方项目与模型说明](https://github.com/IQuestLab/IQuest-Coder-V1)
- [官方 Loop 模型实现，固定版本 61e8589](https://huggingface.co/IQuestLab/IQuest-Coder-V1-40B-Loop-Instruct/blob/61e8589747f6987ec7725e4ffe205f7a84561bd2/modeling_iquestloopcoder.py)

---

### something to discuss

前面我们把两轮计算、跨轮 KV 和后训练讲了一遍。接下来还有一个问题：**表里的分数提高了，究竟能说明哪一步有用？** 先把训练和评测的前提摆出来，再看这个结果能走到哪里。

#### 先把模型训练成两轮，再拿来测试

**LoopCoder 在训练和推理时，都使用固定的两轮循环。** 前面的门 $g$ 调整两份注意力输出的混合比例，两轮仍然都要执行；它没有像 Ouro 的退出门那样决定“这次到第几轮就停”。[原论文 §2.1](https://aclanthology.org/2026.findings-acl.796.pdf#page=2)

作者先利用已预训练的普通 Transformer 权重初始化循环模型，再在循环结构下继续预训练，随后进行 mid-training、SFT 和 RL。所以，这套结果来自一个完整的训练过程。拿一个普通代码模型，只在测试时把它多跑一遍，并不能直接得到论文里的 LoopCoder。

这里用已有权重作为起点，是为了让模型先有可用的表示，再适应反复使用同一组参数。作者在初步尝试中遇到了梯度爆炸，并配合初始化和梯度控制来稳定训练。这个经验说明大模型循环训练需要处理优化问题，但不等于随机初始化在数学上行不通；前面的 Huginn 就采用了从头训练的路线。[原论文 §2.2](https://aclanthology.org/2026.findings-acl.796.pdf#page=3)

前文的 32K、128K 两个中期训练阶段，各有约 300B token，合计 600B。**600B 只是 mid-training 的量，不是整个模型只训练了这么多。** 论文摘要报告预训练使用超过 12T 的代码和通用 token，后面还有 SFT 与 RL。这里 B 表示十亿，T 表示万亿。[原论文摘要、图 3、表 2](https://aclanthology.org/2026.findings-acl.796.pdf#page=5)

> 补充：论文说明了从普通模型权重构造循环起点的思路，但没有完整列出初始化时每层怎样对应、各模型每阶段精确用了多少数据。复现或做严格预算比较时，这些细节仍然有用。

#### 分数提高，具体是哪些事情做得更好了

前面的表主要看生成代码、修改代码和完成工程任务。再补两种测量，能把“代码能力”拆得更清楚。

第一种是跨文件补全。假设我们正在写一个函数，它要调用另一个文件里的类或方法，模型就需要结合给定的跨文件上下文补出代码。CrossCodeEval 测的就是这类情况，包含 Python、Java、TypeScript 和 C#。

**下面比较的是两套训练后的 Instruct 模型：DenseCoder-40B-Instruct 和固定两轮的 LoopCoder-40B-Instruct。** EM 表示补全内容与参考答案完全匹配的比例；ES 表示编辑相似度，越接近参考代码，分数越高。表中是四种语言的平均值，按百分制报告。

| CrossCodeEval 指标 | DenseCoder | LoopCoder |
| --- | ---: | ---: |
| 平均 EM，完全匹配 | 54.5 | 57.8 |
| 平均 ES，编辑相似度 | 82.4 | 85.7 |

EM 提高了 3.3 个百分点，ES 提高了 3.3 分。它说明这套 LoopCoder 在给定跨文件信息后，更能补出符合参考的代码。不过，完全匹配和相似度主要比较文本；一种功能相同、写法不同的程序，也可能拿不到完全匹配分。所以这里的 57.8 不能直接叫作所有程序的“功能正确率”。[原论文表 4、附录 C.1](https://aclanthology.org/2026.findings-acl.796.pdf#page=8)

第二种测量是把程序真正跑起来。HumanEval 要求模型根据题目生成函数，再用测试用例检查；HumanEval+ 为这些题目扩充了测试，进一步检查原先没有覆盖到的输入。仍然比较上面两套 Instruct 模型：

| 评测 | DenseCoder | LoopCoder |
| --- | ---: | ---: |
| HumanEval | 94.2 | 97.6 |
| HumanEval+，扩充测试 | 88.4 | 91.5 |

LoopCoder 在两种测试下都更高，但它自己的分数从 97.6 降到了 91.5。这里模型没有改变，循环轮数也没有改变，改变的是检查程序的测试集。**有些程序通过了原来的测试，增加测试后，才发现还有问题。**[原论文表 5、附录 C.2.1](https://aclanthology.org/2026.findings-acl.796.pdf#page=8)

这也解释了为什么不能把一次测试通过理解成程序对所有输入都正确。测试能提供很实用的反馈，但反馈的范围取决于测试覆盖到了哪里。

SWE-bench 和 Terminal-Bench 又往前走了一步：它们让模型读问题、操作文件或终端，直到完成修复或环境任务。此时成绩还取决于工具怎么提供、允许操作多少次、执行环境是否正常。论文给出了最终系统的结果，但没有把所有外部基线的这些条件都列成完全配平的对照。因此，和其他模型的工程任务分数比较，也要带着运行条件一起看。[原论文表 3、附录 C.2.6](https://aclanthology.org/2026.findings-acl.796.pdf#page=6)

#### 两轮循环、16 份回答、20 个测试，各管什么

这三个数放在一起，很容易都理解成“多算几次”。其实它们各自在不同的位置起作用。

两轮循环，发生在模型生成每个 token 的内部：同一组 Block 先执行一遍，再执行一遍，得到这个位置的预测。16 份回答，发生在竞赛代码 RL 收集训练样本时：同一道题采样 16 次，每次都生成一份完整回答。20 个测试，则用来检查每份回答里的程序，再给它奖励。

因此，一份回答里每个 token 都可以经过两轮计算；同一道题又可以生成 16 份这样的回答。**16 不是内部循环次数，也不表示评测时默认允许尝试 16 个答案。** 前文的 Aider Pass@2 等指标，候选数要按对应评测条件来读。

论文的竞赛代码 RL 约训练 500 步，batch size 为 64，每题 16 次采样，最大上下文为 96K。这些是训练设置；500 步也不表示模型推理时循环 500 次。[原论文 §3.3](https://aclanthology.org/2026.findings-acl.796.pdf#page=7)

组内奖励还有一个直接限制。如果一道题的 16 份代码都没有通过任何测试，奖励全是 0，组内就没有谁比谁更好的信号；如果全部通过，奖励又都相同。部分通过的回答能提供更细的比较，但模型学到的仍是“怎样更容易通过这组测试”，不是得到了程序对所有输入都正确的证明。

> 补充：论文还做了 SWE-RL，让模型在容器里执行多步工具操作，以任务测试通过为主要奖励，并惩罚冗余操作等行为。该管线每次生成 512 条交互轨迹。它和上面的竞赛代码训练是不同设置，不能把 512、16、20 拼成同一个采样流程。[原论文 §3.3](https://aclanthology.org/2026.findings-acl.796.pdf#page=7)

#### 提升究竟来自循环，还是后面的训练

DenseCoder 和 LoopCoder 的比较，说明完整的循环训练方案可以在这些任务上取得更好的结果。要进一步知道每个组件的贡献，还得把它们拆开。

比如，在相同数据和后训练条件下，比较普通模型、直接循环的模型，以及加入跨轮 KV 和门控的循环模型；再固定同一个 SFT 起点，检查加上 RL 后改变多少。若还想比较效率，就要一起控制总训练计算量和推理预算。

**原论文没有分别给出移除跨轮 KV、固定门控、移除 RL 后的独立消融表。** 所以前面 SWE-bench 的 3.8 个百分点等提升，不能全部算在“第二轮 Query 多读了一份 KV”头上。额外计算、初始化、数据和后训练，都可能参与了这套结果。

同样，LoopCoder-Instruct 和 LoopCoder-Thinking 都固定循环两轮。LiveCodeBench V6 从 48.5 到 81.1，并不是把同一个模型从两轮改成更多轮得到的结果，也不能直接当成 RL 单独贡献了 32.6 个百分点。[原论文 §2.1、表 6](https://aclanthology.org/2026.findings-acl.796.pdf#page=8)

Thinking 版本可以生成文字推理，而每个文字 token 输出前，内部仍执行两轮。**隐藏向量里的循环与输出中的文字推理，可以同时存在。** 论文没有给出固定同一模型、只增加内部轮数的扫描实验，因此不能从 Thinking 的高分继续推出“第三轮、第四轮也一定更好”。

#### 参数复用了，计算还要做

官方模型配置有 80 个独立 Block，固定重复执行两轮。把 Block 的执行次数算出来：

$$
80\times2=160.
$$

保存的仍是同一组 80 个 Block 的参数，但生成一个 token 时，这组计算要走两遍。第二轮还有两条注意力分支和门控混合，所以实际 FLOPs 不能只靠这个乘法精确算出来。[官方配置与实现，固定版本 61e8589](https://huggingface.co/IQuestLab/IQuest-Coder-V1-40B-Loop-Instruct/blob/61e8589747f6987ec7725e4ffe205f7a84561bd2/config.json)

跨轮 KV 也要保存、读取。权重共享减少了所需的参数副本，却不会自动省掉所有中间状态的显存开销。论文采用融合门控注意力 kernel，减少中间结果传输和 kernel 启动，并优化长上下文的 KV 分片通信。这些措施是在处理实际运行成本，但正文没有给出优化前后完整的延迟、吞吐和峰值显存对照表。[原论文 §2.3](https://aclanthology.org/2026.findings-acl.796.pdf#page=3)

还有一个容易看错的指标：Mercury 测的是**模型生成的程序运行得有多快**，并结合程序是否正确评分；它没有测 LoopCoder 生成答案的速度。生成的代码更快，不代表生成这些代码的模型也更快。[原论文附录 C.2.4](https://aclanthology.org/2026.findings-acl.796.pdf#page=14)

作者报告整套训练超过百万 GPU 小时，也在局限部分指出，循环增加了训练和推理开销，低延迟场景仍可能受限。这说明 LoopCoder 展示的是一条投入较大、最终有效的训练路线，而不是把循环开关打开就能免费提高代码能力。[原论文 §2.3、Limitations](https://aclanthology.org/2026.findings-acl.796.pdf#page=9)

#### 和前面几篇放在一起，还有什么值得继续看

Huginn 更直接地检查同一个模型增加潜在循环后是否继续受益；Ouro 把各轮预测和退出决策放进训练，并用合成任务讨论知识记忆与操作。LoopCoder 则把循环放进较大的代码模型，贯穿继续预训练和后训练，展示了跨文件、函数生成和工程交互中的结果。

这些实验分别回答了不同问题。LoopCoder 的意义在于，循环结构能经过完整训练，在实际代码任务中成为一个可用的方案。但接下来仍值得检查：在相同运行成本下，它是否更划算；跨轮注意力究竟帮助了哪些步骤；遇到不同任务，是否需要不同轮数；已有权重和稳定训练技巧能否迁移到其他规模、其他领域。

目前主要证据来自代码相关评测，内部迭代究竟怎样改善答案，也还缺少直接的干预实验。把这些问题补清楚，才能更准确地判断它是在哪些情况下值得多走第二遍，而不只是看到分数提高。[原论文 Limitations](https://aclanthology.org/2026.findings-acl.796.pdf#page=9)
