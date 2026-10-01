---
title: transformer(1)
date: 2026-09-30
tags: []
categories:
  - 深度学习
---
> 上一节：[自注意力机制](/blog/read/?post=自注意力机制.md)。文中的结构图可以点击查看原图。

在上一节中，我们考虑了输出向量数量等于输入向量数量的情况。这一节介绍原始 Transformer 如何完成 **seq2seq（序列到序列）** 任务：例如把一句中文翻译成英文，输出序列的长度不必与输入相同。

### Encoder

**Encoder（编码器）** 接收一排向量，输出的仍是一排向量。与上一节一样，每个位置都可以通过自注意力结合其他位置的信息；在此基础上，我们再加入残差连接和归一化，让多层网络更容易训练。

Encoder 由若干个 Block 堆叠而成，每个 Block 包含注意力、前馈网络等子层。有些资料也把整个 Block 称为一个 Transformer layer，阅读时需要留意它指的是哪个层级。

[![Encoder 的多个 Block](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/9ad7d77facb8adf9a57f65adacac28b06afa5875cf9de459a7efc90f48f97f55.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/9ad7d77facb8adf9a57f65adacac28b06afa5875cf9de459a7efc90f48f97f55.png>)

聚焦到一个 Block，先让输入经过多头自注意力，再把**这个注意力子层的输入**与它的输出相加，这就是残差连接（Residual Connection）。若子层的输入是 $x$、变换是 $F$，则结果为：

$$
x+F(x).
$$

这条直接相加的路径可以传递原有表示，也为梯度提供更直接的传播路径，使深层网络更容易优化。后面的前馈子层也使用残差连接，每次相加的都是**当前子层的输入和输出**。

[![残差连接](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/1e6dd8bdc94559aa425d37e3e737a81125c67ca2960637513d80fd61b093175b.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/1e6dd8bdc94559aa425d37e3e737a81125c67ca2960637513d80fd61b093175b.png>)

在原始 Transformer 中，残差相加之后进行层归一化（LayerNorm，简称 LN）。对于序列中的每个 token，分别沿它的特征维度计算均值和方差。假设一个 token 的向量是 $x\in\mathbb{R}^{d}$：

$$
\mu=\frac{1}{d}\sum_{i=1}^{d}x_i,
\qquad
\sigma^2=\frac{1}{d}\sum_{i=1}^{d}(x_i-\mu)^2.
$$

然后计算：

$$
\operatorname{LN}(x)_i
=\gamma_i\frac{x_i-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta_i.
$$

其中 $\epsilon$ 是用于数值稳定的小常数，$\gamma_i,\beta_i$ 是可以学习的缩放和偏移参数。归一化能帮助控制表示的数值尺度、稳定训练，但不能保证深层网络中完全不发生梯度消失或爆炸。

接下来，把 LN 的输出送入前文介绍的**全连接网络**。在这里，它称为逐位置前馈网络（Feed-Forward Network，简称 FFN）：每个位置分别经过同一个网络，不在这一步混合不同位置的信息。

它与《深度学习引入》中分类部分的向量输出式具有相同的形式，由两层线性变换和中间的激活函数组成。原始 Transformer 使用 ReLU：

$$
\operatorname{FFN}(x)
=W_2\operatorname{ReLU}(W_1x+b_1)+b_2.
$$

这里 $W_1$ 把特征维度从 $d_{\mathrm{model}}$ 映射到 $d_{\mathrm{ff}}$，$W_2$ 再映射回 $d_{\mathrm{model}}$，便于与输入做残差相加。此处不接分类用的 softmax，输出仍是特征向量。

经过 FFN 后，再做一次残差相加和 LN，才得到这个 Block 的输出。用 $X$ 表示输入向量按列组成的矩阵，LN 和 FFN 分别作用于每个位置。省略 Dropout 后，整个过程可以写成：

$$
\begin{aligned}
U &= \operatorname{LN}\bigl(X+\operatorname{MultiHeadSelfAttention}(X)\bigr),\\[0.5em]
Z &= \operatorname{LN}\bigl(U+\operatorname{FFN}(U)\bigr).
\end{aligned}
$$

[![Encoder Block 的组成](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/3990b95551d7ae7dd77deac1b477c4f4e69ace63056b6cc7ac6cdf1dd2dd6dc5.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/3990b95551d7ae7dd77deac1b477c4f4e69ace63056b6cc7ac6cdf1dd2dd6dc5.png>)

于是 Encoder 的整体结构如下：

[![Encoder 整体结构](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/0a21984538bbed751077b7f3e2f0fc3db0e3cd27d2b6297aaf6db4f75ce1b748.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/0a21984538bbed751077b7f3e2f0fc3db0e3cd27d2b6297aaf6db4f75ce1b748.png>)

在进入这些 Block 之前，先把文本切分为 token，通过输入嵌入（input embedding）转换成向量，再加入位置编码（positional encoding），让模型能够利用序列中的位置信息。

> 这里介绍的是原始论文中“残差相加后做 LN”的结构，也叫 Post-LN。其他结构可能把 LN 放在子层之前，例如 Pre-LN；具体计算顺序需要结合对应模型来看。

---

### Decoder 结构

**Decoder（解码器）** 的任务是根据输入序列和已经生成的内容，继续预测下一个 token。这种逐步生成的方式叫作自回归生成。

token 不一定是一个汉字，也可能是词、子词或其他文本片段。为了直观理解，下面先假设我们使用一个按汉字划分的词表，其中还包含标点、开始符和结束符等特殊符号。

在每一步，模型都为词表中的各个选项给出分数，再通过 softmax 得到概率分布。这与前文的分类任务相同：假设词表一共有 5000 个选项，就相当于每一步做一道有 5000 个选项的选择题（笑）。训练时，也可以用交叉熵衡量预测概率与真实类别之间的差异。

暂时略去 Decoder 与 Encoder 交互的部分，结构如下：

[![Decoder 结构（暂略交叉注意力）](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/af3ac95268fd98069a6ea849cb1be93f0fb199a4cc5c93a1fe199111f36d2092.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/af3ac95268fd98069a6ea849cb1be93f0fb199a4cc5c93a1fe199111f36d2092.png>)

#### 训练与生成

在实际生成时，Decoder 从开始符出发，预测第一个 token，再把已经生成的 token 接回输入，继续预测下一个，直到输出结束符或达到设定的长度上限。

每步都选择概率最大的 token，称为**贪心解码**；也可以按照概率分布采样等。它们是不同的生成策略。

训练时，我们已经知道完整的目标序列，通常会使用**右移一位的标准答案**作为 Decoder 的输入。例如，目标句子是“我爱学习”，并且在这个例子中每个汉字都是一个 token：

| 位置 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| Decoder 输入 | 开始符 | 我 | 爱 | 学 | 习 |
| 预测目标 | 我 | 爱 | 学 | 习 | 结束符 |

这种使用真实前文作为输入的训练方式叫作 **teacher forcing**。为了避免泄露答案，每个位置只能使用表中当前位置及之前的输入，不能读取后面的输入。

#### 因果掩码

这就需要因果掩码（causal mask）。和上一节可以查看整个序列的自注意力相比，Decoder 的自注意力会屏蔽未来位置：计算出查询与键的注意力分数后，将不允许关注的位置设为负无穷，再做 softmax，使这些位置的权重变为 0。

[![因果掩码：第二个位置可关注前两个位置](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/21249a8f4409289b3c6b758494920c2e3e587bed44067d84bd42bf92d96affd5.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/21249a8f4409289b3c6b758494920c2e3e587bed44067d84bd42bf92d96affd5.png>)

图中计算 $b^2$ 时，$a^2$ 可以关注 $a^1$ 和它自己，对应 $\alpha'_{2,1}$ 与 $\alpha'_{2,2}$；$a^3,a^4$ 则被屏蔽。这里的 $a^2$ 来自右移后的输入，因此关注自己不会看到当前位置要预测的答案。

借助右移和掩码，训练时可以一次输入整条目标序列，并行计算各个位置的预测与交叉熵。实际生成时还没有未来的输出，则需要逐步生成。

---

### Cross-attention

前面暂时略去了 Decoder 与 Encoder 交互的部分。以翻译为例，Decoder 在决定下一个译文词时，除了参考已经生成的译文，还需要查看原句。**交叉注意力（cross-attention）** 就负责从 Encoder 的输出中提取当前需要的信息。

[![交叉注意力的查询、键和值](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/75e52285a24a2430161156eb243efe475dafe5370d4a5251ef66a4d9f803b848.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/75e52285a24a2430161156eb243efe475dafe5370d4a5251ef66a4d9f803b848.png>)

在原始 Transformer 的交叉注意力中，查询来自 Decoder 当前交叉注意力子层的输入，键和值都来自 Encoder 最后一层的输出，并分别经过可学习的线性投影。

沿用上一节把向量按列放置的约定：若 Decoder 当前表示为 $z^i$，Encoder 第 $j$ 个位置的最终表示为 $h^j$，则：

$$
q^i=W^qz^i,\qquad
k^j=W^kh^j,\qquad
v^j=W^vh^j.
$$

接下来的计算与上一节类似：用 $q^i$ 与各个 $k^j$ 计算缩放点积分数，经 softmax 得到权重，再对各个 $v^j$ 加权求和。这样得到的向量就汇总了当前生成位置需要的原句信息。

Decoder 的每个 Block 都有自己的交叉注意力子层，它们读取的是同一组 Encoder 最终输出，并使用各自的投影参数。完整结构如下：

[![完整的 Encoder–Decoder 结构](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/813cf0b5d2170c8ec5f4a27f53477b4a0bc76a95f98153f86b50a0fd1d1f060e.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/813cf0b5d2170c8ec5f4a27f53477b4a0bc76a95f98153f86b50a0fd1d1f060e.png>)

#### 与 Decoder-only 的关系

GPT 这类 Decoder-only 语言模型不使用独立的 Encoder，也没有这里连接 Encoder 的交叉注意力子层。提示文本与已生成文本组成同一个序列，模型通过因果自注意力继续预测后续 token。

许多任务可以组织成文本输入与文本输出的形式，但这并不意味着只需少量微调就能解决任意问题，实际能力还取决于模型、数据和训练方式。

Encoder–Decoder 架构也没有消失，例如 T5 就采用这种结构；交叉注意力还可以用于读取图像或音频编码器提供的表示。因此，理解它仍然有助于阅读翻译模型和多模态模型。

参考：[Attention Is All You Need](https://arxiv.org/abs/1706.03762)、[Layer Normalization](https://arxiv.org/abs/1607.06450)、[T5](https://arxiv.org/abs/1910.10683)。

<br><br><br><br><br><br><br><br><br><br><br><br><br>

