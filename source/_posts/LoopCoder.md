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
