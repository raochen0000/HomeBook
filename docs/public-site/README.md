# App Store 公开页面

此目录是零依赖静态站点。将整个目录部署到已配置 TLS 的域名根目录后，应能访问：

- `https://<domain>/privacy/`
- `https://<domain>/support/`

部署前必须由运营者核对主体名称、联系方式、隐私政策与实际数据处理方式。确认 HTTPS 可从公网访问后，把这两个 URL 写入 `store.config.json` 的 `privacyPolicyUrl` 和 `supportUrl`，再填入 App Store Connect。

不要将这个目录部署到后端的 HTTP 裸 IP；它必须和生产 API 一样使用有效 TLS 证书。
