# 微信ilink可行性试点 · 任务清单

- [x] 留存 ilink 接口参考文档到任务目录 → verify: weixin-bot-api-参考.md 存在
- [x] 写试点脚本 ilink-poc.mjs（login/listen/push） → verify: node --check 通过
- [x] .gitignore 追加 ilink-state.json / ilink-qr.png → verify: git check-ignore 两个文件均命中
- [x] 探测接口连通性（取一次二维码） → verify: HTTP 200 ret=0；qrcode_img_content 实为登录链接而非图片 base64，已改用本地 npx qrcode 生成 PNG
- [x] 大哥扫码登录 → verify: 脚本打印"登录成功"，state 文件有 58 字符 token；状态机 wait→confirmed；二维码有效期约 3 分钟（wait→expired）
- [x] 收/回消息测试 → verify: 终端打印 2 条入站消息（type=1，带 from_user_id/context_token），sendmessage HTTP 200，大哥确认微信收到 2 条自动回复
- [x] 主动推送测试（间隔后，复用旧令牌 / 不带令牌 两种） → verify: 9 次推送接口全部 HTTP 200 但手机全部未收到（无声失败）；另发现出站会话 10-15 分钟自然死亡（第三轮零推送对照实验确认），仅重新扫码可恢复
- [x] 写试点结论 试点结论.md → verify: 已回答三个验收问题（登录✅ / 收回消息⚠️半通 / 主动推送❌）+ 建议保留飞书
