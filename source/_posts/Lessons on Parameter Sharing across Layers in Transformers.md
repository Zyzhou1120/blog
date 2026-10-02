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


### 共享以后，参数怎么训练

前向过程已经安排好了。那反向传播的时候，同一套参数用了好几次，究竟听哪一层的？

**每次使用产生的梯度贡献，都累加到同一套参数上。**

先用一个我们自己构造的标量例子看。它只是演示共享参数，并不是论文的 Transformer 计算式。

设输入是标量 $x$，同一个可学习参数 $w$ 连续乘两次：

$$
h^{(1)}=wx,\qquad h^{(2)}=wh^{(1)}=w^2x.
$$

如果目标是标量 $y$，采用平方损失：

$$
\mathcal L=\frac12(h^{(2)}-y)^2,
$$

那么：

$$
\frac{\mathrm d\mathcal L}{\mathrm dw}
=(w^2x-y)\cdot 2wx.
$$

这里出现 $2wx$，因为前后两次乘法里的 $w$ 都会影响最后结果。

也可以先把这两次使用暂时写成 $w_1,w_2$，得到 $h^{(2)}=w_2w_1x$。求出对两者的梯度后，令它们共享为同一个 $w$，把两份贡献加起来，就会得到上面的结果。

Transformer 也是这个道理。共享的是同一组可学习的矩阵，反向传播仍沿着展开后的所有层进行。前面某次调用的影响，会通过后面的计算继续传到最终损失。

> 补充：翻译任务仍然根据目标句子计算训练损失，官方训练示例使用带 label smoothing 的交叉熵。这里没有另加一个“每层应该学什么”的监督目标，也没有先训练独立的各层、最后再把它们平均。共享关系在构造模型时就已经确定。[作者代码与训练示例](https://github.com/takase/share_layer_params)

推理时也按预设的顺序执行完 $N$ 层，再得到输出。

这里有一处和前文 UT 不同：**本文的 Universal 基线省去了 UT 每层额外加入的正弦位置编码以及 ACT，目的是集中比较参数共享方式。** 因此，下面的结果比较的是这种配置下的共享方法，不能直接理解成完整 UT 与新模型的全面比较。[原论文 §3.1.2，脚注 3](https://aclanthology.org/2023.sustainlp-1.5.pdf#page=3)

### 实验到底改善了什么

#### 翻译：参数相近时，可以更快，也可以用时间换效果

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

先看 12 层的 SEQUENCE。和 Universal 相比，参数量差不多，BLEU 从 $26.90$ 变成 $27.13$，同时吞吐量提高了约 $31\%$。

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

> 补充：本文的证据主要来自从头训练的模型，包括翻译、语音识别和语言建模。论文没有证明某一种共享顺序适用于所有大模型，也没有验证在测试时任意增加层数都会持续改善结果。

### 从 UT 的参数共享继续往下走

接上前文的 UT，我们现在可以把几个问题分开。

UT 让我们看到，同一个更新规则可以反复作用于一排向量；加上 ACT，还可以讨论各个位置什么时候停止。

本篇则把“共享几套参数”和“计算经过几层”分开考虑。既可以共享一套，也可以共享一组；同样一组参数，还能安排成不同的顺序。

所以，如果我们现在手里有一份固定的参数预算，可以先问：这些参数要做成几套 Block，每套多宽，然后让它们以什么顺序、实际执行多少次？

这篇论文给出的三个简单排列，就是可以从这里开始尝试的办法。

> 延伸阅读：[Huginn](/blog/read/?post=Huginn.md) 进一步讨论推理时增加内部计算。它的循环核心包含多个各有参数的层，从整组重复这一点看，和这里的 CYCLE 有相似之处；同时，它还引入了每轮注入输入表示、围绕变化的循环深度训练等设计。理解本篇后，可以继续看它怎样把参数共享用于推理阶段。

### 参考资料

- [原论文：Lessons on Parameter Sharing across Layers in Transformers，SustaiNLP 2023](https://aclanthology.org/2023.sustainlp-1.5/)
- [论文 PDF](https://aclanthology.org/2023.sustainlp-1.5.pdf)
- [作者实现：takase/share_layer_params](https://github.com/takase/share_layer_params)
