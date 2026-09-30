---
title: 深度学习引入
date: 2026-09-29
categories:
  - 深度学习
tags:
  - 开始
---

可以先引入一个问题：**Q: 如果根据许多已知数据想预测未知数据怎么办？**

#### 简单独立一次函数

假设我们要预测二元点列 $(x,y)$, 最简单的方法是思考去使用一个函数去拟合以往的数据，并用函数来判断未知点。

最简单的函数当然是 $y = kx+b$

那么对于给定的 $k,b$，我们可以算出 $\frac{1}{n}\sum |y_i-kx_i-b|$ 当做是 $\text{loss}$, $\text{loss}$ 越低拟合越准。

除了绝对值，工程上还可以用平方误差 $\frac{1}{n}\sum (y_i - (kx_i+b))^2$（即 MSE）

随后就可以选择多种搜索方法来得到最佳的 $k,b$ 使得 $\text{loss}$ 最好即可。

---

#### 考虑周期的一次函数

但是现在有一个问题，当前的函数只是可以独立匹配每一天，因此完全无法考虑数据成周期性波动的情况。

假如某餐厅的客人数量，周末显然会多一些，周中比较少，但以刚才的做法就只会取一个近似平均的位置强行拟合。

我们可以引入更多的特征变量 $x_i$。比如 $x_1$ 代表昨天的客流，$x_2$ 代表前天的客流，或者 $x_3$ 代表今天是否是周末（是取 1，否取 0）。这样就把一元线性方程 $y = kx+b$ 升维成了多元线性方程 $y = \sum_{i=1}^n w_ix_i + b$。

我们只需要得到最佳的 $w_i,b$。

---

#### Relu 单隐层

一次函数显然无法拟合所有函数，引入一个函数 ReLU：

$$f(x) = \max(0, x) = \begin{cases} 0 & \text{if } x < 0 \\ x & \text{if } x \ge 0 \end{cases}$$

用很多的它，就可以很好拟合紧集上的连续函数。

那么我们就可以将 $y = \sum_{i=1}^n w_ix_i + b$ 修改为 

$$
y=b_0+\sum_{i=1}^{m}c_i
\operatorname{ReLU}\left(b_i+\sum_{j=1}^{d}w_{ij}x_j\right).
$$

即

$$
\boxed{
y=b_0+\sum_{i=1}^{m}c_i
\max\left(0,b_i+\sum_{j=1}^{d}w_{ij}x_j\right)
}.
$$

对应的矩阵形式为：

$$
\boxed{
y=b_0+\boldsymbol c^{\mathsf T}
\operatorname{ReLU}(\boldsymbol b+W\boldsymbol x)
}.
$$


其中 ReLU 逐元素作用于向量：

$$
\operatorname{ReLU}(\boldsymbol r)
=
\begin{bmatrix}
\max(0,r_1)\\
\max(0,r_2)\\
\vdots\\
\max(0,r_m)
\end{bmatrix}.
$$

即为单隐层公式。


---

#### 多隐层

单层网络的隐藏表示为：

$$
\boldsymbol a^{(1)}
=\sigma^{(1)}\left(
\boldsymbol b^{(1)}+W^{(1)}\boldsymbol x
\right).
$$

把第一层的输出 \(\boldsymbol a^{(1)}\) 当作下一层的输入：

$$
\boldsymbol a^{(2)}
=\sigma^{(2)}\left(
\boldsymbol b^{(2)}+W^{(2)}\boldsymbol a^{(1)}
\right).
$$

推广到第 \(\ell\) 层：

$$
\boxed{
\boldsymbol a^{(\ell)}
=\sigma^{(\ell)}\left(
\boldsymbol b^{(\ell)}+W^{(\ell)}\boldsymbol a^{(\ell-1)}
\right)
},
\qquad \boldsymbol a^{(0)}=\boldsymbol x.
$$

即 **Fully-conneted network**


---

#### 输出与应用

**Fully-conneted network 只能处理输入是一个向量的场景。**

当一组系数被搜索固定后，输入新的 $x$，可以输出一个固定的 $y$。$x$ 为 “已知条件” 或者 “数字化特征”。

假如你要预测一套房子的最终成交价（这就是那个连续的数字 $y$）。
此时，$x$ 就是这套房子的各项指标向量。比如 $x_1$ 是房屋面积（120平米），$x_2$ 是卧室数量（3间），$x_3$ 是距离地铁站的距离（500米），$x_4$ 是建成年份（2015年）。

- **regression**：
    回归任务，输出的数值即为答案
- **classification**：
    输出的是一个数字，代表语气特征。但是我们需要的是一个选项，一个 **label** ，无法对应，需要用到 **softmax**