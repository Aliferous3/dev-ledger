# Homebrew Cask for the Dev Ledger desktop app (macOS).
#
# This file lives in the repo so every release can be regenerated
# mechanically — it is NOT submitted anywhere yet. When it is, it lands in
# a tap (e.g. Aliferous3/homebrew-tap) verbatim.
#
# Update per release:
#   1. npm run desktop:version        (bumps `version` below)
#   2. fill both sha256 values from the GitHub Release SHA256SUMS.txt
#   3. `brew audit --cask --strict distribution/homebrew/dev-ledger.rb`
cask "dev-ledger" do
  version "1.3.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000000",
         intel: "0000000000000000000000000000000000000000000000000000000000000000"

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
