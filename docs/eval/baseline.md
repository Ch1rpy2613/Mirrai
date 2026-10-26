# 标答与基线 / The cases and the baseline

> 这个文件回答一个问题：**改动之后，这个分身还像不像那个人？**
>
> 这个项目有 121 个测试文件，但它们测的全是**机制**——schema 合不合规、prompt 拼得对不对、
> 状态机切不切。**没有一个测试在问「像不像」。**
> 所以这里放一把尺子。

---

## 一、怎么量的

标答从**导入的真实聊天记录**里切出来，不是从 App 自己的对话里切的——
App 里的对话本来就是分身写的，拿它当标答等于自己给自己判卷。

切法：

1. 把记录里**对方**（TA）的某一句**扣下来**，不给看；
2. 把扣下来之前的那几句话交给重建出来的分身；
3. 让分身把那句再说一遍；
4. 和真正说过的那句比。

扣下来的句子**永远不会出现在上下文里**——否则分身只要复制粘贴就行，
测的就不是它了。这一点有测试守着（`server/eval/dataset.test.ts`）。

标答只取**对方**的回复。用户的消息只当上下文：标答问的是「TA 会怎么说」。

## 二、四个数

| 指标 | 量的是什么 | 越大越好？ |
|---|---|---|
| **overlap** 三字重合率 | 用了同样的词吗 | 越大越像 |
| **likelihood** 似然差 | 这个人会不会这么写（用**他本人**的字 n-gram 模型算） | 越接近 0 越像 |
| **length** 长度差 | 句子长度分布的 Wasserstein 距离 | 越小越像 |
| **emotion** 情绪一致 | 两句读起来是不是同一种情绪 | 越大越像 |

**为什么似然要用「他自己」的模型：**
一个通用的语言模型会告诉你「这句话像不像中文」。这里要问的是
「**这句话像不像他**」。所以模型只用 TA 自己别的句子来拟合，
而且**扣掉的那句不参与拟合**——否则模型只是把答案背下来了。

（现在配的 provider 都不返回 logprobs，所以「困惑度」拿不到；
用**这个人自己的**字 n-gram 模型，既算得出来，又比通用模型更对题。）

**为什么长度比的是分布而不是逐句比：**
一个人说话长短本来就起伏。逐句比会惩罚一个「长度有起伏的分身」，
而这恰恰是**更像**的表现。

## 三、怎么跑

```bash
# 切一组标答，看看切出了什么
pnpm eval -- --persona 1 --user 1 --cases

# 跑一次
pnpm eval -- --persona 1 --user 1

# 跑「关掉判别规则」的版本，和默认版本对比
pnpm eval -- --persona 1 --user 1 --variant withoutRules

# 两遍都跑，直接对比（规则值不值得留，看这个）
pnpm eval -- --persona 1 --user 1 --compare

# 存一次，作为下次的基线
pnpm eval -- --persona 1 --user 1 --save

# 当闸门用：退步了就退出码非零，CI 会红
pnpm eval -- --persona 1 --user 1 --gate
```

没有 provider 或数据库时，命令会明确报出来，不会假装跑过了。

## 四、A/B：规则到底有没有用

规则（microRules）和分态不完美（imperfectionProfile）都可能**让数字变好看但让人变假**。
所以每次都要跑两遍：

```bash
pnpm eval -- --persona <id> --user <id> --compare
```

| | 默认 | withoutRules |
|---|---|---|
| 规则 | 开 | 关 |
| 分态不完美 | 开 | 关 |

命令会把两遍都跑一遍，然后逐项对比：

```
[eval] the same persona, measured both ways:
  overlap      with=0.3120  without=0.2540  delta=+0.0580  better with
  likelihood   with=-1.2000 without=-1.8000 delta=+0.6000  better with
  emotion      with=0.5000  without=0.5000  delta=+0.0000  not better with
```

**如果三项都没有变好，命令会直接说：**
`The rules do not make the persona measurably closer. They are decoration — remove them.`

这是 Phase 1 唯一诚实的验收标准（`roadmap-v3.md` M5）。

## 五、回归判定

跟基线比，容差：

| 指标 | 容差 | 为什么这么宽 / 这么紧 |
|---|---|---|
| overlap | 0.02 | 表面指标容易抖，动一点不算退步 |
| likelihoodGap | 1.0 | 分布指标一动就是性格变了，盯紧 |
| emotionAccuracy | 0.05 | 情绪判断本来就带噪声 |

**回归了 CI 就红。** 这不是形式主义——
一个让分身变得不像自己的改动，如果没有尺子，是不可能被发现的。

## 六、分状态看

每种情绪分开看，因为「只在开心的时候像」也是**一半**像：

```
[eval] per state (words, then the shape of the line):
  · warm       n= 4  overlap=0.3410  length±12.5  sentences±0.75  address±0.50
  · distant    n= 3  overlap=0.2100  length±41.0  sentences±1.33  address±1.00
```

`length±` 是长度差，`sentences±` 是句数差，`address±` 是称呼次数差。
**称呼差大**说明分身在不该叫昵称的时候叫了，或者在该叫的时候没叫——
这是「语气像不像」最容易被忽略的一半。

## 七、时间习惯的基线（D4 / D5）

时间习惯也有一个数：**现在的间隔分布，和真实记录里的间隔分布，差多远**。

```ts
compareTimingToRecord(profile, recordedGaps) // → { ks, recordMedian, profileMedian }
```

`ks` 是 Kolmogorov–Smirnov 统计量：0 表示两个分布一模一样，1 表示完全不重叠。
它回答的是「主动开口的等待时间，现在像不像 TA 自己的习惯」。

同样要**拿真实记录的人来填**——仓库里没有真实记录。

## 八、人的那一半

自动指标只能看表面。**它看不出「这句话像不像他会在这个时候说」。**
所以还有一份人工盲测协议：

见 [`blind-test.md`](./blind-test.md)。

## 九、这份基线目前是空的

原因很直接：**这个仓库里没有真实聊天记录。**
标答必须从真实记录里切，不能造——造出来的标答只能测出「分身像不像我编的那个人」。

所以这一节要由**拿着真实记录的人**来填：

```bash
pnpm eval -- --persona <你的分身 id> --user <你的 id> --save
```

然后把数字抄到这里：

| 日期 | 分身 | 标答数 | overlap | likelihood | length | emotion | KS |
|---|---|---|---|---|---|---|---|
| _待填_ | | | | | | | |
