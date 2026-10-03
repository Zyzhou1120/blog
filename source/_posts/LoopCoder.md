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

和之前几节差不多，$g_{\ell,a,i}$ 由一个预测头训练得来。

$$
g_{\ell,a,i}
=\sigma\!\left(w_{\ell,a}^{\top}q_{\ell,a,i}^{(2)}+b_{\ell,a}\right),
\qquad
\sigma(s)=\frac{1}{1+e^{-s}}.
$$

训练时，门控参数和模型其他参数一起通过最终预测损失更新。 以预测下一个 token 的训练为例，把全部门控参数记为 $\phi=\{w_{\ell,a},b_{\ell,a}\}$，有效预测位置集合记为 $\mathcal T$，损失可写成：

$$
\mathcal L_{\mathrm{LM}}
=-\frac{1}{|\mathcal T|}\sum_{i\in\mathcal T}
\log p_{\theta,\phi}(x_{i+1}\mid x_{\le i}).
$$

预测出错的信号沿后面的层传回到门控。我们只看一个头、一个位置，暂时省略下标：

$$
o=g\,o_{\mathrm g}+(1-g)\,o_{\mathrm l}.
$$

把从后面传回来的梯度记为 $\delta=\nabla_o\mathcal L$，按链式法则，这个位置对门控参数的梯度贡献是：

$$
\begin{aligned}
\beta&=\bigl[\delta^\top(o_{\mathrm g}-o_{\mathrm l})\bigr]g(1-g),\\
\nabla_w\mathcal L\big|_i&=\beta\,q^{(2)},\\
\frac{\partial\mathcal L}{\partial b}\bigg|_i&=\beta.
\end{aligned}
$$

这里 $\beta$ 是一个标量。各个有效位置、各个样本的贡献累积起来，再由优化器更新 $w,b$。如果一次调整让最终预测更准确，训练就会推动门控朝这个方向变化，逐渐学到什么时候多用第一轮的信息、什么时候多用第二轮的信息。这几步是对门控计算的链式法则展开，不是额外添加的训练目标。

每个头、每个位置都完成上面的计算后，在同一个 token 位置把各个头的输出拼起来，经过多头注意力的输出投影，再接上残差和前馈网络。所有位置的结果组成 $X_\ell^{(2)}$，继续送进下一层。把第 $\ell$ 层这整套计算记为 $G_\ell^{(2)}$，逐层连接就是：

$$
\begin{aligned}
X_1^{(2)}&=G_1^{(2)}\bigl(H^{(1)};K_1^{(1)},V_1^{(1)}\bigr),\\
X_2^{(2)}&=G_2^{(2)}\bigl(X_1^{(2)};K_2^{(1)},V_2^{(1)}\bigr),\\
&\ \vdots\\
X_{80}^{(2)}&=G_{80}^{(2)}\bigl(X_{79}^{(2)};K_{80}^{(1)},V_{80}^{(1)}\bigr).
\end{aligned}
$$

80 层走完，再做输出归一化，得到 $H^{(2)}$。所以，**沿第二轮不断更新的是 $X_\ell^{(2)}$；第一轮留下的 $C^{(1)}$ 在这轮保持不变，供对应层读取。两份信息的融合发生在每层的门控注意力输出那里。**

> 补充：论文式 (1) 写的是 $H^{(2)}=F_\theta(E+\operatorname{Shift}(H^{(1)},1))$，但 §2.1 末尾又说明实现没有采用 token shifting；作者公开代码则直接沿用上一轮的 `hidden_states`，既没有 Shift，也没有在轮间再次加上 $E$。论文公式与公开实现存在差异，因此本节按代码解释实际连接方式，上面的两轮公式是对代码流程的概括。[论文 §2.1](https://aclanthology.org/2026.findings-acl.796.pdf#page=2)、[官方代码，固定版本](https://huggingface.co/IQuestLab/IQuest-Coder-V1-40B-Loop-Instruct/blob/61e8589747f6987ec7725e4ffe205f7a84561bd2/modeling_iquestloopcoder.py)

这一组共有 80 个 Block，循环两轮，实际经过的 Block 计算次数就是：

$$
80\times2=160.
$$

第 1 层和第 2 层仍然有不同的参数；共享的是“第一轮第 1 层”和“第二轮第 1 层”，其他层也是如此。

因此，模型不用保存 160 套不同层的权重。但 160 次 Block 计算仍然要做，而且第二轮的注意力结构还有额外处理。**参数省下来了，计算没有免费。**

> 补充：论文使用 40B-A80B 的命名。理解这里的规模时，抓住约 40B 权重和两轮计算即可，不要把它读成 MoE 中“从总参数里选出 80B 专家参数”，也不要据此推断它和普通 80B 模型的 FLOPs、显存或速度完全相同。作者的[模型说明](https://github.com/IQuestLab/IQuest-Coder-V1)列出了 80 层、两次迭代、5120 隐藏维度和 128K 上下文。

### 第二轮可以读取两份信息

如果只把第一轮最后的输出送回入口，第一轮各层算过的信息，就都要靠这份输出继续传下去。

LoopCoder 还保留了一条通路：**每一层在第一轮算出的 Key 和 Value，会留给这一层的第二轮使用。**

所以第二轮的注意力有两份可读的信息：

- 第一轮留下的 $K^{(1)},V^{(1)}$：覆盖较长的可见上下文；
- 第二轮当前计算的 $K^{(2)},V^{(2)}$：反映这一轮已经处理过的内容。

两份信息都要用，但各用多少，由模型自己算。

#### 先分别做两次 attention

我们只看某一层、某一个注意力头，并省略层号和头号。

上标 $(1),(2)$ 表示循环轮次，下标 $i,j$ 表示 token 位置。第二轮第 $i$ 个位置的输入向量，经过该层归一化后记为 $z_i^{(2)}$。再乘投影矩阵，得到：

$$
\begin{aligned}
q_i^{(2)}&=W_Qz_i^{(2)},\\
k_i^{(2)}&=W_Kz_i^{(2)},\\
v_i^{(2)}&=W_Vz_i^{(2)}.
\end{aligned}
$$

这几个都是向量。设这个头的维度为 $d_h$，那么 $q_i^{(2)},k_i^{(2)},v_i^{(2)}\in\mathbb R^{d_h}$。第一轮的 $k_j^{(1)},v_j^{(1)}$ 用相同的投影参数计算，只是输入状态来自第一轮。

为看清信息从哪来，下面省略 RoPE 的位置变换。把全局分支在位置 $i$ 能读的 token 集合记为 $\mathcal G_i$，注意力权重为：

$$
a_{ij}^{\mathrm g}
=
\frac{\exp\bigl((q_i^{(2)})^\top k_j^{(1)}/\sqrt{d_h}\bigr)}
{\displaystyle\sum_{u\in\mathcal G_i}
\exp\bigl((q_i^{(2)})^\top k_u^{(1)}/\sqrt{d_h}\bigr)}.
$$

先拿第二轮的 Query，与第一轮各位置的 Key 算相似度；再在可读位置之间做 softmax。最后把第一轮的 Value 加权起来：

$$
o_i^{\mathrm g}
=\sum_{j\in\mathcal G_i}a_{ij}^{\mathrm g}v_j^{(1)}.
$$

这就是论文的 **global attention**。

另一份结果也是同样的算法，只不过 Key 和 Value 换成第二轮的，并在局部分支能读的集合 $\mathcal L_i$ 上归一化：

$$
\begin{aligned}
a_{ij}^{\mathrm l}
&=\operatorname{softmax}_{j\in\mathcal L_i}
\left(\frac{(q_i^{(2)})^\top k_j^{(2)}}{\sqrt{d_h}}\right),\\
o_i^{\mathrm l}
&=\sum_{j\in\mathcal L_i}a_{ij}^{\mathrm l}v_j^{(2)}.
\end{aligned}
$$

这就是 **local attention**。注意，这两次 softmax 是分别做的，最后还要再合并结果。

比如正在补一个函数，较远处定义了一个变量，最近几行又对它做了处理。第二轮可以同时利用第一轮保存的远处信息，以及这一轮更新后的附近信息。这个例子只是帮助理解两条通路，不表示每个头都被规定了“专门找变量”这样的任务。

> 补充：这里的 global 不表示能看到未来 token。公开代码给全局分支传入因果 mask；局部分支维护一个有限长度的缓存，代码默认窗口为 64。论文式 (3) 简写为第二轮的 $K_{<t},V_{<t}$，公开代码的因果缓存还可包含当前已输入位置，所以正文用“可读位置集合”来表述。预测下一个 token 时，当前输入 token 已经给定，读取它不算偷看答案。这些缓存和 mask 细节以[上述官方代码](https://huggingface.co/IQuestLab/IQuest-Coder-V1-40B-Loop-Instruct/blob/61e8589747f6987ec7725e4ffe205f7a84561bd2/modeling_iquestloopcoder.py)为准。

#### 再决定两份结果各占多少

现在手里有 $o_i^{\mathrm g}$ 和 $o_i^{\mathrm l}$ 两个向量。最终输出是：

$$
o_i=g_i\,o_i^{\mathrm g}+(1-g_i)\,o_i^{\mathrm l}.
$$

$g_i$ 是一个 $0$ 到 $1$ 之间的数。越接近 $1$，越偏向第一轮的全局信息；越接近 $0$，越偏向第二轮的局部信息。

这个数不是人工指定的。按公开实现，每一层的每个头都有一个可学习的向量 $w_g\in\mathbb R^{d_h}$ 和偏置 $b_g\in\mathbb R$，用当前 Query 计算：

$$
g_i=\sigma\bigl(w_g^\top q_i^{(2)}+b_g\bigr),
\qquad
\sigma(x)=\frac{1}{1+e^{-x}}.
$$

一个头在一个位置得到一个标量门值，再把它用到这个头的整个输出向量上。不同层、不同头、不同位置，可以有不同的取舍。

用一个简单例子看，假设：

$$
o_i^{\mathrm g}=\begin{bmatrix}2\\0\end{bmatrix},
\qquad
o_i^{\mathrm l}=\begin{bmatrix}0\\4\end{bmatrix},
\qquad g_i=0.75.
$$

那么：

$$
o_i
=0.75\begin{bmatrix}2\\0\end{bmatrix}
+0.25\begin{bmatrix}0\\4\end{bmatrix}
=\begin{bmatrix}1.5\\1\end{bmatrix}.
$$

两份信息都保留下来，只是比例不同。各个头算完后，再接回多头注意力的输出投影、残差和后面的前馈计算。

**这个门控制“读取哪一轮的信息”，不控制“是否停止循环”。** 它不是 Ouro 的退出概率，也不是 Universal Transformer 中 ACT 的停止分数。LoopCoder 这里仍然固定做两轮。[论文 §2.1，式 (2)–(5)](https://aclanthology.org/2026.findings-acl.796.pdf#page=2)

### 为什么不从随机参数开始训练

结构已经接好了，接下来就是训练。

如果从随机参数开始，同一组 Block 要同时学会两件事：第一轮怎么从 token 表示里提取信息，第二轮怎么接着处理已经变化过的状态。第一轮的输出分布还在变化，第二轮又不断把误差信号传回来，训练容易不稳定。

我们用一个简化的两轮递推看看梯度怎么来。这里暂时把缓存等细节收起来，把状态展平成列向量，输入 $e$ 固定，只讨论共享参数 $\theta$：

$$
\begin{aligned}
h_1&=f_\theta(e),\\
h_2&=f_\theta(h_1),\\
\mathcal L&=\ell(h_2).
\end{aligned}
$$

同一个 $\theta$ 用了两遍。因此改动它时，既会直接改变第二轮，也会先改变第一轮，再通过第一轮结果影响第二轮。

记 $J_1,J_2$ 为两次调用在输入固定时对参数的 Jacobian，$A_2$ 为第二次调用对输入的 Jacobian。如果状态长度为 $m$、参数个数为 $p$，则 $J_1,J_2\in\mathbb R^{m\times p}$，$A_2\in\mathbb R^{m\times m}$。链式法则给出：

$$
\frac{\mathrm dh_2}{\mathrm d\theta}
=J_2+A_2J_1.
$$

所以：

$$
\nabla_\theta\mathcal L
=\bigl(J_2+A_2J_1\bigr)^\top\nabla_{h_2}\mathcal L.
$$

第二项就是绕过第一轮再传回来的影响。循环更多轮时，会出现更长的 Jacobian 连乘；而这里每轮内部本来就已经有 80 层。某些方向上的误差信号可能被不断放大，也可能越来越小。

这就是沿展开后的循环反向传播，也叫 **BPTT**。上面只是用来说明梯度路径的教学推导，实际模型还包含跨轮 KV 等路径。

论文报告，在初步实验中遇到了严重的梯度爆炸。它采用的主要办法，是先拿训练好的 dense checkpoint 初始化循环模型，再从继续预训练阶段开始适应循环结构。

这样，模型不用重新从零学语法、常见代码模式和基础表示，可以把训练更多用在适应“这套参数要连续工作两次”上。

> 补充：论文把初始化称为 dense-to-loop，通过聚合有代表性的 Block 权重来初始化循环模型，但没有给出足够详细的层映射和聚合公式。文中还提到 gradient-scale reduction，却没有完整公开相应的缩放规则。因此不能自行补成“相邻两层取平均”或“梯度统一除以 2”。关于初始化后更稳定的解释，也应理解为作者的机制假设和训练经验，不能当成对任意模型成立的收敛证明。[论文 §2.2、§5 与 Limitations](https://aclanthology.org/2026.findings-acl.796.pdf)

### 代码模型还要学会补、改、验证

只学“根据前面续写后面”，离日常写代码还有一段距离。

比如一个函数中间空了一段，我们希望模型结合前后的代码把它补起来；一个项目出了 bug，我们希望它读报错、定位文件、做修改，再跑测试。这些都需要相应的训练数据。

LoopCoder 的训练大体分成预训练、mid-training 和后训练。论文摘要报告的预训练规模是 **12T+ token**，包含代码和通用文本；mid-training 另外明确列出了两阶段合计 **600B token** 的数据表。论文没有完整拆清所有阶段的去重与统计口径，这里不把它们简单相加成一个新的总量。

#### 补中间：FIM

把一段代码切成前缀 $P$、中间缺失部分 $M$ 和后缀 $S$：

$$
\text{原代码}=P+M+S.
$$

普通续写主要学习从左向右预测；Fill-In-the-Middle，简称 FIM，会把前缀和后缀都先给出来，再要求模型生成中间内容：

```text
<fim_prefix> P <fim_suffix> S <fim_middle> M
```

目标可以写成：

$$
\mathcal L_{\mathrm{FIM}}
=-\sum_{j=1}^{|M|}\log p_\theta(M_j\mid P,S,M_{<j}).
$$

$M_j$ 是缺失部分的第 $j$ 个 token，$M_{<j}$ 是已经生成的部分。这是对 FIM 预测目标的写法，并不意味着论文所有预训练数据都只在这部分计算损失。

这里能看后缀，是因为**后缀已经被摆到输入前面了**，不是把因果 mask 去掉。

论文同时使用文件级 FIM 和仓库级 FIM。后者还会加入同一项目中相关文件的代码，让模型知道函数、类型或接口在别处如何定义。它也使用 $(R_{\mathrm{old}},P,R_{\mathrm{new}})$ 形式的仓库变化数据：旧版本、修改补丁、新版本。这里的 $P$ 指 patch，与上面 FIM 中的前缀不是同一个变量。

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

第二阶段明显增加了 Agent 轨迹和仓库相关数据。原因很直接：单个函数可能只占几行，修一个项目却要在文件、报错、命令输出之间来回查看，需要更长的上下文。

文件级和仓库级两行在原表中都标注了 **50% FIM**；128K 阶段也混入了新的 32K 样本，并不是每个训练样本都长达 128K。[论文 §2.4–§2.5、Table 2](https://aclanthology.org/2026.findings-acl.796.pdf#page=4)

#### 写完代码，再跑测试

后训练先用 SFT 学习指令和任务示范，再用强化学习调整输出。

对于竞赛代码，论文为每道题选取 20 个高质量测试用例，以通过比例作为奖励。设生成的代码为 $c$，第 $k$ 个测试是否通过记为 $v_k(c)\in\{0,1\}$，就可以把奖励写成：

$$
r(c)=\frac{1}{20}\sum_{k=1}^{20}v_k(c).
$$

通过 16 个测试，奖励就是 $0.8$；20 个全通过，奖励才是 $1$。

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
