# 钢琴耳训练

一个纯前端的钢琴相对音感训练工具：网站自动播放 1-3 遍随机音符序列，你在网页钢琴键盘上跟弹，系统逐音实时判断对错。界面采用浅色毛玻璃 + 流动光效，兼容手机和电脑。

## 功能

- 钢琴键盘：完整 88 键（A0-C8），鼠标或手指多指演奏，支持左右滚动、滚轮、拖动滚动条，手机端支持双指捏合缩放琴键（带 1x 重置按钮），PC 和手机端都能按住琴键拖动平移键盘（拖动时自动停止当前键发音），键盘自身不显示滚动条。
- 音色：Web Audio 多泛音加法合成 + 琴槌噪声，比单振荡器更接近真实钢琴。
- 出题设置：只出白键 / 黑白都出，序列长度 1-5 个音，自动播放 1-3 遍，出题音域默认 C4-C5，可在 C1-C8 间自由调整，设置面板实时显示当前出题范围。
- 播放设置：可以选择播放示例时是否高亮琴键。
- 跟弹判断：绝对音高模式，必须弹出与目标完全相同的音，逐音实时判断。
- 实时反馈：按对变绿，按错变红并可自动重播当前音。
- 点击「下一题」即可开始跟弹，播放会继续，可以边听边弹。
- 练习统计：完成时间、弹错次数、最近记录保存在 localStorage。
- 可选 MIDI 键盘：浏览器支持 Web MIDI 时自动接入实体键盘。

## 本地运行

```bash
yarn
yarn dev
```

构建生产版本：

```bash
yarn build
yarn preview
```

构建产物在 `dist/` 目录，是纯静态文件。

## 一键部署

### Vercel

1. 把项目推送到 GitHub。
2. 打开 [vercel.com/new](https://vercel.com/new) 导入仓库。
3. 框架选择自动识别为 Vite，构建命令 `yarn build`，输出目录 `dist`，点击部署。

### GitHub Pages

1. 把仓库设为 Public（免费账号的 Pages 只支持公开仓库）。
2. 在仓库 `Settings > Pages` 里把 Source 选为 `GitHub Actions`。
3. 推送到 `main` 后，workflow 会自动构建并发布，地址为：
   `https://wulichenyang.github.io/piano-ear-training/`

### Netlify

1. 打开 [app.netlify.com/start](https://app.netlify.com/start) 导入仓库。
2. 构建设置：Build command 填 `yarn build`，Publish directory 填 `dist`。

### Cloudflare Pages

1. 打开 [pages.cloudflare.com](https://pages.cloudflare.com) 新建项目并连接 GitHub 仓库。
2. 框架预设选择 Vite，构建命令 `yarn build`，输出目录 `dist`。

也可以直接构建后把 `dist/` 文件夹拖到 Netlify Drop 或 Cloudflare Pages 上传。
