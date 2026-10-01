---
title: universal transformer
date: 2026-10-01
tags: []
categories:
  - - loop transformer
  - - 论文
priority: 2
---
> 上一节：[transformer](/blog/read/?post=transformer.md)。

前文中，我们让一排向量经过若干个 Block，每经过一个，就得到一排新的向量。Transformer 已经能把不同位置的信息结合起来，但遇到需要反复运用同一个规则的问题，仍然可能做不好。

比如字符串复制：输入 `1234`，输出 `1234`。规则看起来很简单，但如果训练时只见过长度为 40 的串，测试时突然换成长达 400 的串，模型还能正确去做吗？UT 论文做了这类实验，发现当时的 Transformer 基线在这种长度外推上表现很差。[原论文 §3.4](https://arxiv.org/html/1807.03819v3#S3.SS4)

再看结构。假设模型有 6 个 Block，那么无论句子长短、某个位置是否需要更多次信息交换，每个位置都走这 6 层。序列变长后，注意力计算量确实会增加，但**每个位置经过的变换层数仍然固定**。

这就引出一个问题：能不能让模型学会一套可以重复使用的处理方法？能不能根据输入，决定这套方法要用几次？这样子就可以节省大量参数量，且可以当遇到很简单的输入时候，节省运算量，遇到困难输入的时候，自动增加运算。 [作者介绍](https://research.google/blog/moving-beyond-translation-with-the-universal-transformer/)

Universal Transformer（简称 UT）于是把原先堆叠的 Block 改为共享参数的循环计算，并进一步尝试用 ACT 决定循环次数。前者让同一个更新规则反复使用，后者让计算轮数可以变化。在本论文中作者钦定 $k=1$，即只用一个 block 来循环若干次。

此方法可以大大减少参数量（未必减少计算量）。

此方法不一定严格在所有任务中都比原式 transformer 更优秀。

> 这里说的是原论文实验中观察到的短板，不是说 Transformer 在理论上绝对不能复制字符串。能读到所有位置的信息，也不等于已经学会了可以推广到更长输入的规则。

---

### universal transformer 中的结构

先回顾一下，普通 Transformer 中，不同 Block 虽然结构相似，但里面的参数各有一套。比如第一个 Block 的 $W^q$，和第二个 Block 的 $W^q$，是分别训练的。

规定 $H^{(t)}$ 是第 $t$ 轮 Block 输出的整排向量，其中第 $i$ 列记为 $h_i^{(t)}$。用 $H^{(0)}$ 表示最开始的一排向量，那么原先的过程是：

$$
H^{(0)}\xrightarrow{\mathrm{Block}_1}H^{(1)}
\xrightarrow{\mathrm{Block}_2}H^{(2)}
\xrightarrow{\mathrm{Block}_3}H^{(3)}.
$$

现在我们把它改为：

$$
H^{(0)}\xrightarrow{\mathrm{Block}_{\theta}}H^{(1)}
\xrightarrow{\mathrm{Block}_{\theta}}H^{(2)}
\xrightarrow{\mathrm{Block}_{\theta}}H^{(3)}.
$$

block 里面的过程和之前一样：先做 self-attention，让不同位置交换信息，再做残差连接、LN、前馈网络等等。

但是唯一的不同是，其参数 $\theta$ 是共享的。也就代表的其所有 block 使用的是 **同一套参数**，也可以说成其把一个参数的 block 循环了若干次。

这里还有一个小问题。原先我们加入 positional encoding，是为了告诉模型“这个向量在句子中的哪个位置”。现在同一个 block 被反复使用，于是还可以告诉它现在是第几轮。

整体的计算过程如下：第一轮从 token 的 embedding 开始，后面每轮的输入为上一轮的输出加上位置与轮数编码后，本轮输入为：

$$
x_i^{(t)}=h_i^{(t-1)}+P_i^{(t)}.
$$

把整排输入 $X^{(t)}$ 送进前文的 Block，就得到整排输出 $H^{(t)}$，其中第 $i$ 列便是 $h_i^{(t)}$。

用 $P^{(t)}$ 表示位置编码与第 $t$ 轮编码之和，省略 Dropout，采用前文的 FFN 时，可以写成：

$$
\begin{aligned}
X^{(t)} &= H^{(t-1)}+P^{(t)}, \\[0.5em]
A^{(t)} &= \operatorname{LN}\left(X^{(t)}+\operatorname{SelfAttention}(X^{(t)})\right), \\[0.5em]
H^{(t)} &= \operatorname{LN}\left(A^{(t)}+\operatorname{FFN}(A^{(t)})\right).
\end{aligned}
$$

注意，SelfAttention 这里使用多头版本；不要忘了做 LN 和 残差连接。

上面说的“第几轮”，是整排向量更新了几次，循环了几次相同 block 。同一轮中，各个位置可以并行计算。[原论文 §2.1](https://arxiv.org/html/1807.03819v3#S2.SS1)

---

### ACT

接下来最重要的问题是，我们究竟循环多少次。

我们当然可以提前规定循环次数固定 $= x$，但更好的方法是加入 **ACT（Adaptive Computation Time，自适应计算时间）**，让不同位置分别学习什么时候停止。

原作者提出了一个想法，即对每一轮循环都给予一个 “进度条的进度” $\alpha_i^{(t)}$。当进度条进度满了后，就可以停止循环。不仅如此，作者还将这个进度赋予了别的含义，既这一轮结果对最终结果的贡献权重。直观上来看，这一轮如果贡献了较多的 “进度”，那它也相对于更 "重要"。

按 ACT 原论文的方式，我们会把各轮得到的向量加权合成，作为这个位置的最终输出：

$$
\bar h_i=\sum_{t=1}^{N_i}\alpha_i^{(t)}h_i^{(t)}.
$$

其中，$h_i^{(t)}$ 就是上面得到的本轮输出，$N_i$ 是这个位置实际计算的轮数，$\alpha_i^{(t)}$ 是分给这一轮的权重。带横线的 $\bar h_i$ 则是合并各轮结果后的最终输出。

这里希望得到各轮向量的**加权平均**，所以让权重非负，并且总和为 $1$：

$$
\alpha_i^{(t)}\ge 0,\qquad \sum_{t=1}^{N_i}\alpha_i^{(t)}=1.
$$

[ACT 原论文，式 9](https://arxiv.org/html/1603.08983v6#S2)


> **补充：UT 附录中的输出合并写法**
> **我个人认为这个更合理一些，因为后面循环结果也许会更加优秀一些。**
> 上面展示的是 ACT 的加权求和形式，官方代码中也提供了 `accumulated` 选项。UT 论文附录 C 的伪代码则采用逐轮插值：
>
> $$
> \bar h_i^{(t)}=
> \alpha_i^{(t)}h_i^{(t)}+
> \left(1-\alpha_i^{(t)}\right)\bar h_i^{(t-1)},
> \qquad \bar h_i^{(0)}=0.
> $$
>
> 两种写法的停止分数、阈值和余量思路相同，但得到的向量一般不同，不能把两条公式当作等式互换。对照实现时，需要确认使用的是哪一种。[官方代码中的两种更新](https://github.com/tensorflow/tensor2tensor/blob/master/tensor2tensor/models/research/universal_transformer_util.py#L1060-L1065)

---

### 停止分数的计算

那我们如何获得 $\alpha$，又如何保证它和为 $1$ 呢？作者提出以下方法：

论文中训练了一个预测头，来找到每轮的 $\alpha$，由于当前还没有保证和为 $1$，先用 $p$ 进行表示。

预测头读取的是**本轮输入** $x_i^{(t)}$，先做线性变换，再做 sigmoid，得到：

$$
p_i^{(t)}=\operatorname{sigmoid}\left(w_h^{\mathsf T}x_i^{(t)}+b_h\right),
\qquad
\operatorname{sigmoid}(z)=\frac{1}{1+e^{-z}}.
$$

$w_h,b_h$ 是需要训练的参数，在不同位置和不同轮次复用。sigmoid 保证 $p_i^{(t)}$ 落在 $0$ 到 $1$ 之间。

这个数称为 **停止分数**。[官方实现](https://github.com/tensorflow/tensor2tensor/blob/master/tensor2tensor/models/research/universal_transformer_util.py)

注意，$\left(w_h^{\mathsf T}x_i^{(t)}+b_h\right)$ 只是为了训练的一个简单线性变化，你当然也可以将其换为更复杂的变换。


令前 $t$ 轮停止分数的和为：

$$
C_i^{(t)}=\sum_{j=1}^{t}p_i^{(j)}.
$$

设置一个接近 $1$ 的阈值，比如 $1-\epsilon=0.99$。第一次达到阈值时就停止，同时设置最大轮数 $T_{\max}$：

$$
N_i=\min\left(
\left\{t:C_i^{(t)}\ge 1-\epsilon\right\}
\cup\left\{T_{\max}\right\}
\right).
$$

也就是说，要么提前达到阈值，要么到上限后结束。这里 $N_i$ 就是这个位置实际计算的轮数。

为了让前面加权平均的权重总和恰好为 $1$，最后一轮需要补齐剩余份额。无论停止分数累计后略低于 $1$，还是已经超过 $1$，停止的那一轮都只拿“还差多少”的部分，叫作 **remainder（余量）**：

$$
R_i=1-\sum_{t=1}^{N_i-1}p_i^{(t)}.
$$

**$p_i^{(t)}$ 是预测头直接算出的分数，$\alpha_i^{(t)}$ 才是实际乘在向量上的权重。** 停止前两者相等，停止的最后一轮则把权重换成余量：

$$
\alpha_i^{(t)}=
\begin{cases}
p_i^{(t)}, & t<N_i,\\
R_i, & t=N_i.
\end{cases}
$$
---
### 一些计算优化

如果只关心答案是否正确，模型没有充分的理由节省计算。所以训练时还要加一个 **ponder cost（计算代价）**。

作者定义第 $i$ 个位置的代价是：

$$
\rho_i=N_i+R_i.
$$

> 笔者在阅读这里的时候有过疑问，为什么循环轮数 $N_i$ 和一个最后一轮的权重分数 $R_i$ 能加在一起表示代价。解释是 
> 1. 为了防止丢失梯度，轮数只是整数，会导致梯度消失
> 2. 如果 $R_i$ 更小，则前面积累进度更高，则是作者更想看到的，可以更快结束

对一条含 $n$ 个有效 token 的序列，可以把这些代价取平均，和原先的任务损失相加：

$$
L=L_{\mathrm{task}}+\tau\frac{1}{n}\sum_{i=1}^{n}\rho_i.
$$

$L_{\mathrm{task}}$ 可以是前文的交叉熵；$\tau$ 是人为设定的系数，越大就越强调少算几轮。如果太强调节省计算，也可能让模型过早停止，影响答案质量。[ACT 原论文 §2.1](https://arxiv.org/html/1603.08983v6#S2.SS1)

我们不需要给每个词标注“你应该算 3 轮”。模型通过任务损失和计算代价，一起学习处理信息的参数与停止预测头的参数。

---

### 一些实验数据

LAMBADA 需要结合一段上下文预测最后一个词。下面取论文中语言模型设置的测试集 **perplexity（困惑度）**，越低越好：

| 模型 | 测试集困惑度 |
| --- | --- |
| UT，固定 6 轮 | 319 |
| UT，固定 8 轮 | 202 |
| UT，固定 9 轮 | 239 |
| UT + ACT | **142** |

数据见[原论文表 3](https://arxiv.org/html/1807.03819v3#S3.T3)。ACT 相比固定 6 轮，困惑度下降约 $55.5\%$，但这不等于准确率提高 $55.5\%$。

ACT 在这里平均计算约 8.2 轮。作者因此额外训练了固定 8 轮和 9 轮的模型，两者仍未达到 ACT 的结果。这个对照支持动态分配计算的价值，也说明“多堆几轮”不一定就更好。

#### 翻译任务

在 WMT14 英语到德语翻译上，论文报告：

| 模型 | BLEU（越高越好） |
| --- | --- |
| Transformer base | 28.0 |
| UT base，**不带 ACT** | 28.9 |

这里提升了 **0.9 个 BLEU 分数点**。论文报告两者参数量相同，UT 使用全连接前馈变换。[原论文 §3.6、表 7](https://arxiv.org/html/1807.03819v3#S3.SS6)

这项提升来自不带 ACT 的 UT；论文反而提到，加入动态停止后，翻译结果略有下降。因此，共享参数的循环计算和 ACT 是否有用，需要分别看任务与实验。
