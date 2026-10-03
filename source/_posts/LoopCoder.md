---
title: LoopCoder
date: 2026-10-02
tags: []
categories:
  - - loop transformer
  - - 论文
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

- 第二轮：

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

只学“根据前面续写后面”，离日常写代码还有一段距离。

比如一个函数中间空了一段，我们希望模型结合前后的代码把它补起来；一个项目出了 bug，我们希望它读报错、定位文件、做修改，再跑测试。这些都需要相应的训练数据。

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

这里能看后缀，是因为**后缀已经被摆到前面了**，不是说是把因果 mask 去掉了。

#### 从 32K 上下文扩展到 128K

mid-training 先在 32K 长度上适应推理和工具操作，再加入更长的 128K 数据。两阶段各约 300B token。

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


#### 写完代码，再跑测试

后训练先用 SFT 学习指令和任务示范，再用强化学习调整输出。

对于竞赛代码，论文为每道题选取 20 个高质量测试用例，以通过比例作为奖励。设生成的代码为 $c$，第 $k$ 个测试是否通过记为 $v_k(c)\in\{0,1\}$，就可以把奖励写成：

$$
r(c)=\frac{1}{20}\sum_{k=1}^{20}v_k(c).
$$


但“比其他候选好多少”也很重要。同一道题采样一组代码后，GRPO 会根据这一组结果的相对表现更新策略。更好的候选被鼓励，较差的候选被压低。这里的 16 次 rollout 是 16 份候选回答，**不是一次回答在内部循环 16 轮**。

论文这个阶段使用每个 prompt 16 次 rollout、batch size 64、约 500 个训练 step，最大上下文 96K；去掉 KL 惩罚，并采用受 DAPO 启发的 Clip-Higher 策略。

项目修复任务则更长：模型读取问题、调用工具、修改文件、运行测试，得到一整条操作轨迹。论文的 SWE-RL 主要看任务测试是否通过，同时对冗长上下文、重复工具调用和无效修改施加轻量惩罚，每轮生成 512 条轨迹。[论文 §3.3](https://aclanthology.org/2026.findings-acl.796.pdf#page=7)

这里其实有两种不同的“反复”：模型内部用同一套参数算两轮；模型外部还可以多次调用工具、根据报错继续修改。前者处理隐藏向量，后者会产生可见的代码和操作记录。

### 最后是怎样生成代码的

给定当前已经输入的 token，模型完成第一轮计算，留下各层的 KV；第二轮在共享主体参数的同时，读取两种来源的信息，再合并结果。

第二轮最后一个位置的向量经过归一化和词表投影，得到下一个 token 的概率。把输出归一化后的向量记为 $h_i^{(2)}\in\mathbb R^d$，词表大小记为 $V$，则：

$$
p(x_{i+1}\mid x_{\le i})
=\operatorname{softmax}\bigl(W_{\mathrm{out}}h_i^{(2)}\bigr),
\qquad W_{\mathrm{out}}\in\mathbb R^{V\times d}.
$$

选出下一个 token，接在后面，再继续生成。使用 KV cache 时，已经算过的历史 Key 和 Value 可以复用，不需要每生成一个 token 都完整重算整个前缀。

第一轮内部的向量不会自动变成一段“我先思考一下”的文本。与此同时，Thinking 版本也可以通过推理数据和后训练学习输出显式推理过程。内部循环和外部文字推理可以同时存在。

所以，看到名字里的 Thinking，也不能反推它一定比 Instruct 多执行了若干轮 Block。本文结构部分给定的循环次数就是两轮。

### 实际提升有多少

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

不过，**这个比较不是同等计算量下的纯结构消融**。LoopCoder 多做了一轮计算，还有初始化、训练数据和后训练过程的共同作用。仅凭这张表，不能拆出每个因素分别贡献了多少。

Thinking 版本在代码推理上的结果更高。论文 Table 6 中：

| 模型 | CruxEval I-COT | CruxEval O-COT | LiveCodeBench V6 |
| --- | ---: | ---: | ---: |
| LoopCoder-40B-Instruct | 91.1 | 85.5 | 48.5 |
| LoopCoder-40B-Thinking | 98.5 | 99.4 | 81.1 |

CruxEval 的两列分别涉及根据程序和输出寻找输入、根据程序和输入推断输出，并使用带推理过程的评测方式。LiveCodeBench V6 的差值是 32.6 个百分点，但它比较的是 **Instruct 和 Thinking 两种训练与输出模式**，不是把固定两轮改成三轮的收益。

论文 Figure 2 也混用了不同变体：LiveCodeBench V6 用 Thinking，其余所列项目用 Instruct。读这类总览图时，要先确认每个分数来自谁。

> 补充：ACL 版本附录 C.2.6 写到 SWE-bench Verified 为 81.4，而 Table 3 与 Figure 2 的 LoopCoder-Instruct 是 76.2；附录没有在那句话中交代清楚对应变体和设置。因此本篇采用主表中明确标注模型的 76.2，不把两个数字混在一起。不同工具框架、提示词、重试预算也可能影响 Agent 评测，横向比较不能只看参数量。

### 这篇给前面的循环模型补了什么

Universal Transformer 让我们看到，同一套参数可以在深度方向反复使用；Huginn 和 Ouro 进一步讨论了潜在状态怎样更新、计算深度怎样扩展或选择。

LoopCoder 则把问题推进到一个具体场景：已有一个较大的代码模型，怎样让它适应循环，并把这种结构用到完整的软件任务里。

这里值得记住三件事。

第一，循环不一定从头训练。可以从 dense checkpoint 出发，在继续预训练时就适应两轮计算，而不是只在最后微调时把线路接上。

第二，第二轮不必只接收上一轮的最终输出。各层第一轮的 KV 也可以继续提供信息，再通过门控与本轮的信息合并。

第三，代码能力仍然需要具体任务来训练。FIM、仓库变化、工具轨迹和测试反馈，决定模型能从训练中学到什么；循环结构不会自动替代这些数据。

至于“把轮数继续加大就一定更强”“40B 循环两次就等于普通 80B 模型”“内部一定在按人类步骤检查代码”，这篇的实验还不能给出这样的结论。它报告了两轮循环代码模型的有效结果，也明确承认额外计算和延迟的代价。

对这一系列来说，它把关注点从“循环怎么设计”往前推了一步：**循环接好以后，还要让模型在训练中真正学会使用它。**

### 参考资料

- [LoopCoder: Scaling Code Intelligence via Looped Language Models，ACL 2026](https://aclanthology.org/2026.findings-acl.796/)
- [ACL 版本论文全文](https://aclanthology.org/2026.findings-acl.796.pdf)
- [IQuest-Coder-V1 官方项目与模型说明](https://github.com/IQuestLab/IQuest-Coder-V1)
- [官方 Loop 模型实现，固定版本 61e8589](https://huggingface.co/IQuestLab/IQuest-Coder-V1-40B-Loop-Instruct/blob/61e8589747f6987ec7725e4ffe205f7a84561bd2/modeling_iquestloopcoder.py)
