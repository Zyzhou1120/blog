---
title: transformer(1)
date: 2026-09-30
tags: []
categories:
  - 深度学习
---
在上一节中我们考虑了输出数量等于输入数量的情况，这一节中 transformer 主要帮助我们解决 **seqtoseq** 类型的任务，即序列到序列，输出数量是不定的。

### Encoder

**Encoder** 中的结构和需要解决的问题和上一节都差不多。不过增加了一些内容去避免一些问题，且使得训练出的答案更优秀。

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



> 注意：encoder 结构不一定是固定的，上述结构为初始论文提出的。完全可以尝试其他的 LN，FC，self-attention，residual 等等的组合结构。







<br><br><br><br><br><br><br><br><br><br><br><br><br>