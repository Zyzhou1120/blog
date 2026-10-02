---
title: Lessons on Parameter Sharing across Layers in Transformers
date: 2026-10-02
tags: []
categories:
  - - loop transformer
  - - 论文
---

> 前文：[universal transformer](/blog/read/?post=universal%20transformer.md)。
>
> 本篇介绍 Sho Takase 和 Shun Kiyono 的论文 [Lessons on Parameter Sharing across Layers in Transformers](https://aclanthology.org/2023.sustainlp-1.5/)，以 SustaiNLP 2023 发表版本为准。

前文的 Universal Transformer，让一套 Block 的参数反复使用。假设原先要走 6 层，现在仍然走 6 层，但只需要保存一套参数。

这个办法很省参数。不过，我们也把原本 6 套参数各自可以学习的东西，全交给了同一套参数。它既要处理刚输入的向量，也要处理经过好几轮更新的向量。

相信大家在读上一篇的时候已经可以提出这个问题了，那能否 **不要求所有层都共用同一套参数，而是准备几套参数，每套都循环一下？用什么方式去循环？**

比如原本的 `A A A A A A`，可以改成 `A B C A B C`。这样存 3 套参数，计算经过了 6 层。

universal transformer 相当于把所有的参数量都放到了一个大宽 block，本文研究和比较了使用多一些的维度比较小的窄的 block。

---

### 假设与建模


| 记号 | 含义 |
| --- | --- |
| $M$ | 独立的 Block 参数有多少套 |
| $N$ | 一次前向计算，实际经过多少层 Block |

它们满足 $1\le M\le N$。

普通的不共享模型对应 $M=N$；所有层共享一套参数，对应 $M=1$。现在可以选择中间的情况，比如 $M=3,N=6$。

沿用前文的习惯，每个 token 是一列。设 $H^{(0)}\in\mathbb{R}^{d\times n}$ 是输入 Encoder 的整排向量，$n$ 是 token 数量。第 $\ell$ 层得到的结果记为 $H^{(\ell)}$。

我们还需要一个编号 $g(\ell)$，表示第 $\ell$ 层使用哪一套参数。于是可以统一写成：

$$
H^{(\ell)}
=\operatorname{Block}_{\theta_{g(\ell)}}\left(H^{(\ell-1)}\right),
\qquad \ell=1,\ldots,N.
$$

这里 $\theta_1,\ldots,\theta_M$ 是需要学习的参数；$g(\ell)$ 是我们事先安排好的编号。

变的是参数的安排方式，Block 内部仍然做注意力、前馈网络、残差连接和 LN。

> 补充：论文主要研究 Encoder–Decoder 模型，两侧分别按自己的共享安排构造。比如翻译实验中的 $M=6,N=12$，表示 Encoder 有 6 套参数、执行 12 层，Decoder 也有自己的 6 套参数、执行 12 层。并不是 Encoder 和 Decoder 共用这 6 套参数。

下面用 $A,B,C$ 表示三套不同参数对应的 Block。相同字母再次出现，就表示复用同一套参数。表格从左向右是向量经过各层的顺序。

| 方法 | $M=3,N=6$ 时的执行顺序 |
| --- | --- |
| SEQUENCE | `A A B B C C` |
| CYCLE | `A B C A B C` |
| CYCLE (REV) | `A B C C B A` |

三种方法的独立参数套数和执行层数都一样，区别只在排列。[原论文 §2、Figure 1–2](https://aclanthology.org/2023.sustainlp-1.5.pdf#page=2)


### 实验结果

有一处和前文 UT 不同：**本文的 Universal 基线省去了 UT 每层额外加入的正弦位置编码以及 ACT，目的是集中比较参数共享方式。** 因此，下面的结果比较的是这种配置下的共享方法，不能直接理解成完整 UT 与新模型的全面比较。[原论文 §3.1.2，脚注 3](https://aclanthology.org/2023.sustainlp-1.5.pdf#page=3)

先看英语翻译成德语。论文使用 WMT 2016 的约 450 万句对训练，在 newstest2010–2016 上评测。采用区分大小写、去分词后的 SacreBLEU，分数越高越好。

下表的 BLEU 是这些测试集上的平均值；每种配置还先对 3 个随机种子训练出的模型取平均。训练共 5 万次更新，论文使用 V100 GPU。速度指**训练时每秒处理的 token 数**，以 Universal 为 $1.00$，不是生成一个 token 的延迟。

| 配置 | $M$ | $N$ | 总参数量 | 相对训练速度 | 平均 BLEU |
| --- | ---: | ---: | ---: | ---: | ---: |
| 普通 Transformer | 6 | 6 | 61M | 2.02 | 26.48 |
| Universal | 1 | 6 | 63M | 1.00 | 26.90 |
| Universal，加深 | 1 | 12 | 63M | 0.52 | 26.77 |
| SEQUENCE | 6 | 12 | 61M | 1.31 | 27.13 |
| CYCLE | 6 | 12 | 61M | 1.31 | 27.04 |
| CYCLE (REV) | 6 | 12 | 61M | 1.31 | 27.08 |
| SEQUENCE | 6 | 18 | 61M | 0.98 | 27.02 |
| CYCLE | 6 | 18 | 61M | 0.98 | 27.25 |
| CYCLE (REV) | 6 | 18 | 61M | 0.98 | 27.31 |

数据来自[原论文 Table 1、Appendix B](https://aclanthology.org/2023.sustainlp-1.5.pdf#page=4)。其中 M 表示百万，参数量包含模型的其他部分。

和 Universal 相比，参数量差不多，BLEU 从 $26.90$ 变成 $27.13$，同时吞吐量提高了约 $31\%$。

如果要处理相同数量的训练 token，时间大约变成原来的：

$$
\frac{1}{1.31}\approx 0.763.
$$

也就是少用约 $23.7\%$ 的时间。吞吐提高 $31\%$ 和时间减少 $31\%$，是两种不同的计算。

再看 18 层的 CYCLE (REV)。速度为 $0.98$，与 Universal 基本相当，平均 BLEU 则提高了 $27.31-26.90=0.41$。可以理解为：把接近的训练时间，花在更多层较窄的变换上。

同时，普通 Transformer 的速度仍然更快。新方法在这组实验中提供的是参数量、训练速度和翻译质量之间的另一种选择，并没有每一项都超过普通模型。

还有一个值得留意的结果：Universal 从 6 层加到 12 层，速度几乎减半，平均 BLEU 却从 $26.90$ 变成了 $26.77$。只让同一个 Block 多做几遍，在这组实验中没有自动换来更好的结果。

#### 哪种排列最好，要看任务

翻译表格里，12 层时 SEQUENCE 的平均分最高，18 层时则是 CYCLE (REV)。这已经说明，不能只记住一个“最佳顺序”。

论文还在 WikiText-103 上做了 decoder-only 的语言建模实验，使用带 adaptive inputs 的 Pre-LN Transformer。下面几种模型都是约 121M 参数，训练 5 万次更新。指标是测试集困惑度（perplexity），越低越好。

| 配置 | $M$ | $N$ | 测试困惑度 |
| --- | ---: | ---: | ---: |
| 普通 Transformer | 6 | 6 | 21.13 |
| Universal | 1 | 6 | 23.84 |
| SEQUENCE | 6 | 12 | 19.69 |
| CYCLE | 6 | 12 | 19.69 |
| CYCLE (REV) | 6 | 12 | 20.24 |

这里 SEQUENCE 和 CYCLE 的测试结果相同，都优于 CYCLE (REV)。Universal 也没有超过普通模型。[原论文 Appendix A、Table 5](https://aclanthology.org/2023.sustainlp-1.5.pdf#page=12)

作者还观察到了不同任务、不同 LN 位置下的差异，但这些实验没有单独排除所有其他因素，所以只能说它们可能有关，不能据此确定某个顺序为什么必胜。

### 参考资料

- [原论文：Lessons on Parameter Sharing across Layers in Transformers，SustaiNLP 2023](https://aclanthology.org/2023.sustainlp-1.5/)
- [论文 PDF](https://aclanthology.org/2023.sustainlp-1.5.pdf)
- [作者实现：takase/share_layer_params](https://github.com/takase/share_layer_params)
