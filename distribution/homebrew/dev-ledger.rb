# Homebrew Cask TEMPLATE for the Dev Ledger desktop app (macOS).
#
# This file lives in the repo so every release can be regenerated
# mechanically — it is NOT submitted anywhere yet. When it is, it lands in
# a tap (e.g. Aliferous3/homebrew-tap) verbatim.
#
# Fill per release (see distribution/README.md):
#   1. bump package.json to the NEW release version, then
#      npm run desktop:version        (substitutes {{VERSION}} below)
#   2. fill both sha256 values from the GitHub Release SHA256SUMS.txt
#   3. `brew audit --cask --strict dev-ledger.rb`
#
# The URL filename matches the canonical release-asset contract produced
# by scripts/release-assets.mjs — do not rename it here.
cask "dev-ledger" do
  version "1.4.1"
  sha256 arm:   "82440b712d59b56d46847ac6594c8e2e43a8eab0ab2ac75e4055d80e913ec212",
         intel: "200ccbbc2861c3553030714dde35e5e23a51dc9a54d1e28923a57859602b9a6a"

  arch arm: "aarch64", intel: "x64"

  url "https://github.com/Aliferous3/dev-ledger/releases/download/v#{version}/Dev-Ledger_#{version}_#{arch}.dmg"
  name "Dev Ledger"
  desc "Open-source GitHub analytics for developers"
  homepage "https://devledger.site"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Dev Ledger.app"

  zap trash: [
    "~/Library/Application Support/site.devledger.desktop",
    "~/Library/Caches/site.devledger.desktop",
    "~/Library/WebKit/site.devledger.desktop",
  ]
end
