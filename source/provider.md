# 分区检录源

`GET /inspection/counters` 给区域台号、回执区间、网关给出的缺口。 `GET /inspection/batch?counter=值&part=值` 返回 `seq`、检查凭据号和被更正的凭据号。检查的日期、范围及项目按资料流标注。所谓跨台凭据由赛事方派给可领的台。
`GET /turnstile/passes` 返回通行凭据、已接收目标门及状态。状态 `printed` 为发证台出单但未到门，`loaded` 已到门未过闸，`entered` 已过闸，`revoked` 旧门已清。 `POST /turnstile/revoke` 传 `pass`、`gate`，202 表示待旧门处理。 `POST /turnstile/issue` 传 `stage`、`athlete`、`mask`、`gate`。该模拟只核对外部单，不计算面罩资格。
初始 `merge`，旧门晚确认进 `acknowledged`。新赛区回执与旧区域读取范围可以在两档之间分别查询。
