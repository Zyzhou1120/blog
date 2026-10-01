---
title: transformer
date: 2026-09-30
tags: []
categories:
  - 深度学习初步
permalink: 2026/09/30/transformer(1)/
---
> 上一节：[自注意力机制](/blog/read/?post=自注意力机制.md)。文中的结构图可以点击查看原图。

在上一节中，我们考虑了输出向量数量等于输入向量数量的情况。这一节介绍原始 Transformer 如何完成 **seq2seq（序列到序列）** 任务：例如把一句中文翻译成英文，输出序列的长度不必与输入相同。

### Encoder

**Encoder（编码器）** 接收一排向量，输出的仍是一排向量。与上一节一样，每个位置都可以通过自注意力结合其他位置的信息；在此基础上，我们再加入一些别的结构，让多层网络更容易训练。

Encoder 由若干个 Block 堆叠而成，每个 Block 包含许多子层。

[![Encoder 的多个 Block](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/9ad7d77facb8adf9a57f65adacac28b06afa5875cf9de459a7efc90f48f97f55.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/9ad7d77facb8adf9a57f65adacac28b06afa5875cf9de459a7efc90f48f97f55.png>)

聚焦到一个 Block，第一层是 multi self-attention 部分。只不过需要略微修改，把**这个注意力子层的输入**与它的输出相加，再往上传播。

若子层的输入是 $x$、变换是 $F$，则结果为：

$$
x+F(x).
$$

这样可以防止在多层传播中原始特征慢慢被稀释、被丢失，也为梯度提供更直接的传播路径，使深层网络更容易优化。
此过程即为残差连接（Residual Connection）。



[![残差连接](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/1e6dd8bdc94559aa425d37e3e737a81125c67ca2960637513d80fd61b093175b.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/1e6dd8bdc94559aa425d37e3e737a81125c67ca2960637513d80fd61b093175b.png>)

做完残差连接后，需要做一层 normalization，现在一般使用的是 Layer Norm。是计算同一个样本的不同维度的平均值 $m$ 和标准差 $\sigma$，然后计算：

$$x'_i = \frac{x_i-m}{\sigma}$$

这样可以有效防止数值膨胀，减轻梯度消失与梯度爆炸风险。

> **补充：LayerNorm 的完整计算**
>
> 在原始 Transformer 中，残差相加之后进行层归一化（LayerNorm，简称 LN）。对于序列中的每个 token，分别沿它的特征维度计算均值和方差。假设一个 token 的向量是 $x\in\mathbb{R}^{d}$：
>
> $$
> \mu=\frac{1}{d}\sum_{i=1}^{d}x_i,
> \qquad
> \sigma^2=\frac{1}{d}\sum_{i=1}^{d}(x_i-\mu)^2.
> $$
>
> 然后计算：
>
> $$
> \operatorname{LN}(x)_i
> =\gamma_i\frac{x_i-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta_i.
> $$
>
> 其中 $\epsilon$ 是用于数值稳定的小常数，$\gamma_i,\beta_i$ 是可以学习的缩放和偏移参数。归一化能帮助控制表示的数值尺度、稳定训练，但不能保证深层网络中完全不发生梯度消失或爆炸。

接下来，把 LN 的输出送入前文介绍的全连接网络。在这里，它称为逐位置前馈网络（Feed-Forward Network，简称 FFN）：

$$
\operatorname{FFN}(x)
=W_2\operatorname{ReLU}(W_1x+b_1)+b_2.
$$

经过 FFN 后，再做一次残差相加和 LN，才得到这个 Block 的输出。


[![Encoder Block 的组成](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/3990b95551d7ae7dd77deac1b477c4f4e69ace63056b6cc7ac6cdf1dd2dd6dc5.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/3990b95551d7ae7dd77deac1b477c4f4e69ace63056b6cc7ac6cdf1dd2dd6dc5.png>)

于是 Encoder 的整体结构如下：

[![Encoder 整体结构](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/0a21984538bbed751077b7f3e2f0fc3db0e3cd27d2b6297aaf6db4f75ce1b748.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/0a21984538bbed751077b7f3e2f0fc3db0e3cd27d2b6297aaf6db4f75ce1b748.png>)

可以看到在经过若干 Block 之前经过了 input embedding （将自然语言转换成向量），以及 positional encoding （前文提出的位置编码）


> 这里介绍的是原始论文中“残差相加后做 LN”的结构，也叫 Post-LN。其他结构可能把 LN 放在子层之前，例如 Pre-LN；具体计算顺序需要结合对应模型来看。

---

### Decoder 结构

现在主流使用的是自回归版本的 **Decoder**，目标是根据输入序列和已经生成的内容，继续预测下一个 token。

token 如果是汉字的话，可以假设我们使用一个按汉字划分的词表，（注意其中还包含标点、开始符和结束符）

看起来这个很像一个之前提到的 classification 的任务。也确实如此，如果排除掉和 encoder 的关联，它和这个结构是很像的，毕竟从所有汉字中选择一个最大的，和做一个有 5000 个选项的选择题是一样的（笑）。

在每一步，模型都为词表中的各个选项给出分数，再通过 softmax 得到概率分布。训练时，也可以用交叉熵计算 loss 函数，和之前做简单分类任务一模一样。


暂时略去 Decoder 与 Encoder 交互的部分，结构如下：

[![Decoder 结构（暂略交叉注意力）](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/af3ac95268fd98069a6ea849cb1be93f0fb199a4cc5c93a1fe199111f36d2092.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/af3ac95268fd98069a6ea849cb1be93f0fb199a4cc5c93a1fe199111f36d2092.png>)

我们注意到自注意力机制前面增加了 mask。这也很好理解，上一节模型可以查看整个序列的自注意力（例如标注一个句子里所有词的词性，我们都可以先获得句子中所有词的信息）。

但现在是一个预测接龙任务，所以在训练的时候不能提前将标准答案传入，提前泄露答案，其自注意力屏蔽未来位置（当然在它预测结束后，还是要给定标准答案和他预测出来的结果做交叉熵。）


[![因果掩码：第二个位置可关注前两个位置](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/21249a8f4409289b3c6b758494920c2e3e587bed44067d84bd42bf92d96affd5.png>)](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/21249a8f4409289b3c6b758494920c2e3e587bed44067d84bd42bf92d96affd5.png>)

如图所示，图中计算 $b^2$ 时，$a^2$ 可以关注 $a^1$ 和它自己，对应 $\alpha'_{2,1}$ 与 $\alpha'_{2,2}$；$a^3,a^4$ 则被屏蔽。

---

### cross-attention

前面暂时略去了 Decoder 与 Encoder 交互的部分。以翻译为例，Decoder 在决定下一个译文词时，除了参考已经生成的译文，还需要查看原句。**交叉注意力（cross-attention）** 就负责从 Encoder 的输出中提取当前需要的信息。

但实际上，现在 LLM 主流的结构，gpt 所使用的是抹掉这一块的 decoder-only 结构。

毕竟无论是什么问题，本质都可以稍加变化将其变成一个概率接龙问题，需要的只是稍稍微调。

但是虽然现在的 LLM 已经不用了，但 cross-attention 被抹掉的和 encoder 相关这部分还是在多模态部分有广泛应用，所以还是简单提一下。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/75e52285a24a2430161156eb243efe475dafe5370d4a5251ef66a4d9f803b848.png>)

$q$ 来自 Decoder 当前交叉注意力子层的输入，$k$ 来自 Encoder 的输出, 用 \(q^i\) 与各个 \(k^j\) 计算缩放点积分数，经 softmax 得到权重，再对各个 \(v^j\) 加权求和即可。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/813cf0b5d2170c8ec5f4a27f53477b4a0bc76a95f98153f86b50a0fd1d1f060e.png>)

参考：[Attention Is All You Need](https://arxiv.org/abs/1706.03762)、[Layer Normalization](https://arxiv.org/abs/1607.06450)、[T5](https://arxiv.org/abs/1910.10683)。

<br><br><br><br><br><br><br><br><br><br><br><br><br>

