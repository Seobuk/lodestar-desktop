// 릴리즈 매니페스트(latest.json) 생성 — tauri-plugin-updater가 읽는 형식.
// 사용: node scripts/make-latest.mjs <version>
// 빌드 산출물(setup.exe + .sig)이 있어야 하며, url은 GitHub Releases 에셋 주소.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("사용법: node scripts/make-latest.mjs <version>");
  process.exit(1);
}
const dir = "src-tauri/target/release/bundle/nsis";
const exe = `Lodestar_${version}_x64-setup.exe`;
const sig = readFileSync(`${dir}/${exe}.sig`, "utf8").trim();
const manifest = {
  version,
  notes: `Lodestar Desktop v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: sig,
      url: `https://github.com/Seobuk/lodestar-desktop/releases/download/v${version}/${exe}`,
    },
  },
};
writeFileSync(`${dir}/latest.json`, JSON.stringify(manifest, null, 2));
console.log(`latest.json 생성 완료 (v${version})`);
