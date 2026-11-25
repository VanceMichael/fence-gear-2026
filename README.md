# 击剑装备换用时的复检证据接收

这里的资料由本地来源模拟器提供，编号、参与方和历史业务记录全部为合成数据。运行环境为 Node.js 22.23.4。

## 启动来源

资料源默认监听 `127.0.0.1:8700`，可用 `PORT` 调整：

```sh
npm run source
```

外部检查台/闸机演练服务默认地址为 `http://127.0.0.1:8701`，可用 `PROVIDER_PORT` 调整：

```sh
npm run provider
```

另开终端运行 `npm test` 可检查来源契约和检录判断。测试以独立临时端口启动来源。

## 检录主管看板

主管服务默认监听 `http://127.0.0.1:8702`，会连接本机 `8700/8701`：

```sh
npm start
# 或显式指定
SOURCE_URL=http://127.0.0.1:8700 PROVIDER_URL=http://127.0.0.1:8701 PORT=8702 npm start
```

打开 `http://127.0.0.1:8702/` 可按场次查看：

- 每名选手建议使用哪副面罩、可实际从哪个门过闸；
- `printed`、`loaded`、`entered`、`revoked` 通行证事实；
- 已过闸未交回面罩的优先暂留；
- 旧门 `loaded` 单的撤销/等待确认；
- 外壳或绑带缺少哪一项证据、需要哪个区域/剑种/时段的复检；
- 无可行换用时的具体补借需要。

常用 JSON 接口：

```sh
curl -X POST http://127.0.0.1:8702/api/refresh
curl 'http://127.0.0.1:8702/api/board?stage=B1&now=35'
curl -X POST http://127.0.0.1:8702/api/gate \
  -H 'content-type: application/json' \
  -d '{"stage":"B1","gate":"B"}'
curl -X POST http://127.0.0.1:8702/api/process \
  -H 'content-type: application/json' \
  -d '{"stage":"B1","athlete":"P5"}'
```

`POST /api/receipt` 可接收闸机回执并继续办理；`POST /api/return` 记录面罩交回；`POST /api/delay` 记录场次延时。

也可直接使用命令行：

```sh
node cli.mjs --stage=B1 --now=35
node cli.mjs --stage=B1 --athlete=P5 --process
```

## 核心规则

- 检查证据按面罩、剑种、实际区域和比赛时段匹配；`strap` 与 `shell` 必须分别合格。
- 新复检/`supersedes` 只撤回被指明的旧检查项；例如 T6 撤回 T2 的外壳，不影响 T1 的绑带。
- 旧台缺页时，检查台批次或另一区域回执中的同面罩、同项目凭据可作为跨台证据。
- 领用区间按半开区间判断重叠；延时会重新计算占用。
- `entered` 且无交回记录的面罩优先保留，不能自动发给下一人。
- `loaded` 旧门单未确认 `revoked` 前，同面罩不能再发有效单；`printed` 单未到门时可按主管新指定门重办。
- 推荐动作只负责安全步骤：先撤销旧门 `loaded`，收到 `revoked` 回执后再签发推荐面罩。

两版业务记录和取件字段见 [资料格式](source/formats.md)。`POST /control?edition=r2` 模拟业务方更换当期资料，切回 `r1` 可重新查看初始来源。

本地演练外部接口的来源语义、操作回执和演练档见 [外部接口](source/provider.md)。
