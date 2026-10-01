---
title: transformer(1)
date: 2026-09-30
tags: []
categories:
  - 深度学习
---
> 本节的上一节是 **自注意力机制**。

在上一节中我们考虑了输出数量等于输入数量的情况，这一节中 transformer 主要帮助我们解决 **seq2seq** 类型的任务，即序列到序列，输出数量是不定的。

### Encoder

**Encoder** 中的组成和需要解决的问题和上一节都差不多。不过增加了一些内容去避免一些问题，且使得训练出的答案更优秀。

其输入的是一排向量，输出的也是一排向量，其中会经过若干的 Block。这里的 Block 不是 layer。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/9ad7d77facb8adf9a57f65adacac28b06afa5875cf9de459a7efc90f48f97f55.png>)


聚焦于每一个 block 而言，第一层是 self-attention 部分，不过需要和之前的略微修改。将原先的初始输入也要拉上来，和输出加一起，再往上传播。

这个是为了防止在多层传播中原始特征慢慢被稀释、被丢失。此过程即为残差连接（Residual Connection）

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/1e6dd8bdc94559aa425d37e3e737a81125c67ca2960637513d80fd61b093175b.png>)

做完残差连接后，需要做一层 normalization，现在一般使用的是 Layer Norm。是计算同一个样本的不同维度做平均值 $m$ 和标准差 $\sigma$，然后做。

$$x'_i = \frac{x_i-m}{\sigma}$$

这样可以有效防止数值膨胀，减轻梯度消失与梯度爆炸风险。

再用 LN 的输出为输入做一次 FC，做一次 residual，再做一次 LN，才是此 block 的输出。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/3990b95551d7ae7dd77deac1b477c4f4e69ace63056b6cc7ac6cdf1dd2dd6dc5.png>)

于是 encoder 整体结构如下：

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/0a21984538bbed751077b7f3e2f0fc3db0e3cd27d2b6297aaf6db4f75ce1b748.png>)


可以看到在经过若干 block 之前经过了 input embedding （将自然语言转换成向量），以及 positional encoding （前文提出的位置编码）


> 注意：encoder 结构不一定是固定的，上述结构为初始论文提出的。完全可以尝试其他的 LN，FC，self-attention，residual 等等的组合结构。

---
### decoder 结构

现在主流使用的是自回归版本的 **decoder**，目标是逐个字输出，每个输出后的字都当做新的输入回归。

那么如果以汉语输出为例。可以想到，我们的目标可以是可以让模型对于每个即将输出的位置，都可以计算出一个所有汉字出现在当前的概率，并选择一个概率最大的输出（这里除了汉字，也可以是标点，可以是结束符）。

看起来这个很像一个之前提到的 classification 的任务。也确实如此，如果排除掉和 encoder 的关联，它和这个结构是很像的，毕竟从所有汉字中选择一个最大的，和做一个有 5000 个选项的选择题是一样的（笑）。

如果抛去和 encoder 相关联的部分，事实上也确实如此。

做 softmax 和训练时候 loss 函数所用的交叉熵算法都和之前做简单分类任务一模一样。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/af3ac95268fd98069a6ea849cb1be93f0fb199a4cc5c93a1fe199111f36d2092.png>)

上图中只有一点变化了，那就是 multi-head attention 之前增加了一个 Mask。

这也很好理解，之前的 “输出数量和输入数量相同” 的任务，比如把一句话所有词标注词性，模型预测一个词的词性，是可以直接读取到所有其他词的信息的。

但现在是一个预测接龙任务，所以在训练的时候不能将标准答案传入，提前泄露答案（当然在它预测结束后，还是要给定标准答案和他预测出来的结果做交叉熵。）


![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/21249a8f4409289b3c6b758494920c2e3e587bed44067d84bd42bf92d96affd5.png>)

可以看到图中算 $b^2$ 的时候，$a^2$ 只和 $a^1$ 做关联，此时 $a^3,a^4$ 均未知。（此图与上一节图可以进行对比）

---

### cross-attention

实际上，现在 LLM 主流的结构，gpt 所使用的也恰好是被抹掉中间这一块的 decoder-only 结构。

毕竟无论是什么问题，本质都可以稍加变化将其变成一个概率接龙问题，需要的只是稍稍微调。

但是虽然现在的 LLM 已经不用了，但中间被抹掉的和 encoder 相关这部分还是在多模态部分有广泛应用，所以还是简单提一下。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/75e52285a24a2430161156eb243efe475dafe5370d4a5251ef66a4d9f803b848.png>)

只用在中间用 decoder 的 q 以及 encoder 一些层的 k 做若干次类似操作即可。

![image](<https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/813cf0b5d2170c8ec5f4a27f53477b4a0bc76a95f98153f86b50a0fd1d1f060e.png>)







<br><br><br><br><br><br><br><br><br><br><br><br><br>

