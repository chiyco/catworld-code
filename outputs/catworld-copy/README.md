# 猫猫世界源码

Worker: `catworld-copy`
D1: `catworld-copy`
在线地址: https://catworld-copy.1551504894.workers.dev

这是可部署的 JavaScript Cloudflare Worker + D1 + Durable Objects 项目，包含猫咪等级与健康产出、猫娘 API 对话、好友私聊、猫猫大厅和随机大地图。生产环境需要设置 `DATA_KEY` secret；本目录不含任何 token 或 secret。

## 本地运行

```powershell
npm install
npx wrangler d1 execute catworld-copy --remote --file=./schema.sql
npx wrangler d1 execute catworld-copy --remote --file=./migrations/0002_social.sql
npx wrangler dev
```

测试：`npm run check`、`npm test`。`tests/integration.mjs` 使用两个浏览器账号验证真实在线流程；`migrations/0002_social.sql` 是好友、私聊和猫娘对话表的增量迁移。
