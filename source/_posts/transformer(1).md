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

