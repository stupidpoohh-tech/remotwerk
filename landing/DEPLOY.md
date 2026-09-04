# Remotwerk Landing — Cloudflare Pages

## Git integration

- Repository: `stupidpoohh-tech/remotwerk`
- Production branch: `claude/remotwerk-desktop-app-lcys33`
- Framework preset: None
- Root directory: `/`
- Build command: `exit 0`
- Build output directory: `landing`

Cloudflare Pages should deploy the static files inside `landing/` directly.

## Release download

`landing/index.html` resolves the latest public GitHub Release at runtime and links the primary `.exe` asset directly. If the GitHub API lookup fails, it falls back to the currently known `v0.9.3` installer.

## Notes

- `_headers` contains basic security headers for Pages.
- Character images and animation frames are loaded from this public GitHub repository.
- Before public 1.0, replace placeholder legal links with full Privacy Policy / Terms pages and apply Windows code signing.
