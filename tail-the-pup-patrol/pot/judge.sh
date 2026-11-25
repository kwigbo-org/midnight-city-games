#!/usr/bin/env bash
# An independent judge for Tail the Pup Patrol, set up and kept up to date by one script.
# Everything it runs comes from the public repo, and nothing is used before it's verified. First the
# release itself: its tag must be signed with the release key pinned below (read this file before you
# run it: that key is your root of trust, and every update keeps it). Then the game: the sealed files
# against SEAL.sha256, the seal against the pot's game hash on chain, and the contract compiled here
# against the circuits deployed on chain.
#
#   judge.sh setup <slot C|D|E>   once: checks, fetches, verifies, makes your key and wallet, crons
#   judge.sh update               daily (cron): moves to a new season or pot only once it verifies
#   judge.sh status               what you're running, and whether your key holds a slot
#   judge.sh attest               (cron) post tonight's outcome from your own recording
#   judge.sh record               (cron) record tonight's run
#
# Needs: Linux on UTC time, Node 22, Docker, git, the Compact compiler (`compact`, compiler 0.36.0), crontab.
# Lives in ~/tail-judge (TAIL_JUDGE_HOME): releases/<tag>/ (each verified checkout), current -> the
# verified one in use, runs/ (your recordings: keep them, the newcomer rule counts them), judge.env.
# Your secrets stay outside it: ~/judge-keys.json and ~/judge-wallet.json, readable only by you.
set -euo pipefail
REPO_URL="${TAIL_JUDGE_REPO:-https://github.com/kwigbo-org/midnight-city-games.git}"
HOME_DIR="${TAIL_JUDGE_HOME:-$HOME/tail-judge}"
KEYS="$HOME/judge-keys.json" WALLET="$HOME/judge-wallet.json"
# The release signing key: tail-judge-tools-* tags are signed with it (git SSH signatures).
RELEASE_SIGNER="tail-releases@kwigbo.com namespaces=\"git\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHIFRpZqVJyNk0NsVfF0m5s7HsrosZv1SBMe2I2pG/s1"
PROOF_PORT="${TAIL_JUDGE_PROOF_PORT:-6300}" PROOF_NAME="${TAIL_JUDGE_PROOF_NAME:-tail-judge-proof}"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=advice.detachedHead GIT_CONFIG_VALUE_0=false
log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "STOP: $*" >&2; exit 1; }
mkdir -p "$HOME_DIR/releases" "$HOME_DIR/runs" "$HOME_DIR/logs"
cd "$HOME_DIR"

need() { command -v "$1" >/dev/null || die "$1 isn't installed (${2:-})"; }
checks() {
  need node "Node 22"; need docker; need git; need crontab; need compact "the Compact compiler, https://docs.midnight.network"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node 22 or later is needed"
  # The run is at 22:00 UTC and the crons are written in UTC: the machine must keep UTC (not every cron
  # honours CRON_TZ).
  # UTC itself, not a zone that's +0000 only part of the year (London in winter).
  # The machine's own setting (what cron uses), not this shell's TZ.
  local tz; tz=$(timedatectl show -p Timezone --value 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's|.*zoneinfo/||' || true)
  [[ "$tz" =~ ^(UTC|Etc/UTC|Etc/Universal|Universal|Zulu|Etc/Zulu)$ ]] && [ "$(env -u TZ date +%z)" = "+0000" ] \
    || die "this machine's timezone is '${tz:-unknown}', not UTC: set it, e.g. sudo timedatectl set-timezone UTC"
}

# The public pointer: which tag, pot and game hash are current (tail-the-pup-patrol/judge-current.json
# on the public repo's main branch). It's only a hint: everything it names is verified before use.
pointer() {
  if [ -d repo/.git ]; then git -C repo fetch -q --depth 1 origin main && git -C repo checkout -q -f FETCH_HEAD
  else git clone -q --depth 1 "$REPO_URL" repo; fi
  cat repo/tail-the-pup-patrol/judge-current.json
}
field() { node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const v = j[process.argv[1]]; if (v === undefined) process.exit(1); console.log(v)' "$1"; }

# Fetch a tag into releases/<tag> and verify it; prints nothing, exits non-zero on any failure.
verify_release() {
  local tag="$1" pot="$2" game="$3" version="$4" dir="releases/$1"
  [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "odd tag name: $tag"
  [[ "$pot" =~ ^[0-9a-f]{64}$ && "$game" =~ ^[0-9a-f]{64}$ && "$version" =~ ^[0-9]+$ ]] || die "the pointer is malformed"
  # The release, fetched fresh, and its tag's signature checked before anything in it runs.
  rm -rf "$dir"; git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "$REPO_URL" "refs/tags/$tag:refs/tags/$tag" || die "can't fetch $tag"
  printf '%s\n' "$RELEASE_SIGNER" > "$HOME_DIR/allowed_signers"
  git -C "$dir" -c gpg.ssh.allowedSignersFile="$HOME_DIR/allowed_signers" verify-tag "$tag" >/dev/null 2>&1 \
    || die "$tag isn't signed with the release key: not using it"
  git -C "$dir" checkout -q "refs/tags/$tag"
  local g="$dir/tail-the-pup-patrol"
  log "verifying $tag (signed with the release key)"
  # 0. The compiler the pointer names (the contract must compile to exactly what's on chain).
  local want; want=$(field compiler < "$g/judge-current.json")
  # (`compact compile --version` prints the compiler's own version, e.g. "0.36.0 (b5d9e4dfc …)".)
  local have; have=$(compact compile --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1 || true)
  [ "$have" = "$want" ] || die "the Compact compiler here is '${have:-none}', the pot needs $want: compact update $want (and compact use, if your compact has it)"
  # 1. The sealed game: every file, and the seal is the pot's game hash.
  (cd "$g" && sha256sum --quiet -c SEAL.sha256) || die "$tag: a sealed file doesn't match SEAL.sha256"
  [ "$(sha256sum "$g/SEAL.sha256" | cut -c1-64)" = "$game" ] || die "$tag: the seal isn't the game hash $game"
  # 2. The deployment record for this pot (public: the organizer's agent only by its hash).
  local dep="$g/pot/deployments/v$version.json"
  [ -f "$dep" ] || die "$tag: no deployment record pot/deployments/v$version.json"
  [ "$(field address < "$dep")" = "$pot" ] && [ "$(field gameHash < "$dep")" = "$game" ] || die "$tag: the deployment record names another pot"
  # Never an older release than one this machine already accepted: each signed release carries a
  # number ("release" in its own pointer), and the highest accepted is kept in release-floor.
  local rel floor; rel=$(field release < "$g/judge-current.json" 2>/dev/null || echo x); floor=$(cat "$HOME_DIR/release-floor" 2>/dev/null || echo 0)
  [[ "$rel" =~ ^[0-9]+$ && "$floor" =~ ^[0-9]+$ ]] || die "$tag: its pointer has no release number"
  [ "$rel" -ge "$floor" ] || die "$tag is release $rel, older than release $floor already accepted here: not going back"
  # The signed release's own pointer must name the same tag, pot, version and game hash.
  [ "$(field tag < "$g/judge-current.json")" = "$tag" ] && [ "$(field pot < "$g/judge-current.json")" = "$pot" ] \
    && [ "$(field version < "$g/judge-current.json")" = "$version" ] && [ "$(field gameHash < "$g/judge-current.json")" = "$game" ] \
    || die "$tag: its own signed pointer disagrees with the published one"
  # 3. The contract: compiled here from the published source, compared with the pot on chain.
  # Packages as locked, with no install scripts run.
  (cd "$g/pot" && npm ci --ignore-scripts --silent --no-audit --no-fund >/dev/null && ./compile.sh "v$version" >/dev/null) || die "$tag: install or compile failed"
  local out; out=$(cd "$g/pot" && TAIL_POT_CONTRACT="tail-pot-v$version" node verify.mjs "$pot" 2>&1) || die "$tag: verify.mjs failed: $(tail -3 <<<"$out")"
  grep -q "^VERIFIED" <<<"$out" || die "$tag: the deployed contract doesn't match its source"
  grep -q "^game hash *$game" <<<"$out" || die "$tag: the pot's game hash on chain isn't $game"
  # 4. The pot is still open: one that has moved to a successor is a past season, never one to judge
  # (so an old signed release, named by a stale or tampered pointer, is refused here, in setup and update).
  local st; st=$(cd "$g/pot" && TAIL_POT_CONTRACT="tail-pot-v$version" TAIL_POT_DEPLOYMENT="$PWD/deployments/v$version.json" node call-v3.mjs status 2>/dev/null || true)
  grep -q '"open":true' <<<"$st" || die "$tag: pot $pot is closed (moved to a successor) or unreadable: not judging it"
  log "verified $tag: seal, deployment record, and every circuit of pot $pot"
}

# Switch current -> releases/<tag> at once; never while a run is being recorded or judged.
switch_to() {
  local h; h=$(date -u +%H%M)
  if [ "$h" -ge 2140 ] || [ "$h" -lt 0030 ]; then log "not switching during the run and its judging: next update"; return 0; fi
  # The floor first (ahead of current is safe: it only refuses older releases), then the switch.
  field release < "releases/$1/tail-the-pup-patrol/judge-current.json" > "$HOME_DIR/release-floor.tmp" && mv -f "$HOME_DIR/release-floor.tmp" "$HOME_DIR/release-floor"
  ln -sfn "releases/$1" current.tmp && mv -T current.tmp current
  cp "current/tail-the-pup-patrol/pot/judge.sh" "$HOME_DIR/judge.sh.new" && chmod +x "$HOME_DIR/judge.sh.new" && mv -f "$HOME_DIR/judge.sh.new" "$HOME_DIR/judge.sh"
  log "now on $1"
}

env_file() {
  local slot="$1" version; version=$(field version < current/tail-the-pup-patrol/judge-current.json 2>/dev/null || field version < repo/tail-the-pup-patrol/judge-current.json)
  cat > judge.env <<EOF
export TAIL_JUDGE_SLOT=$slot
export TAIL_POT_CONTRACT=tail-pot-v$version
export TAIL_POT_KEYS=$KEYS
export TAIL_POT_WALLET=$WALLET
export TAIL_POT_DEPLOYMENT=$HOME_DIR/current/tail-the-pup-patrol/pot/deployments/v$version.json
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:$PROOF_PORT
export TAIL_RULES=$HOME_DIR/current/tail-the-pup-patrol/rules.json
EOF
}

proof_server() {
  local image; image=$(field proofServer < current/tail-the-pup-patrol/judge-current.json)
  # Pinned by digest, from the signed release's own pointer.
  [[ "$image" =~ ^midnightntwrk/proof-server:[0-9.]+@sha256:[0-9a-f]{64}$ ]] || die "odd proof server image: $image"
  # The pinned image, running, on 127.0.0.1:<port>: anything else is made again.
  local want="$image true 127.0.0.1:$PROOF_PORT"
  local have; have=$(docker inspect -f '{{.Config.Image}} {{.State.Running}} {{range (index .HostConfig.PortBindings "6300/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$PROOF_NAME" 2>/dev/null || true)
  if [ "$have" != "$want" ]; then
    docker rm -f "$PROOF_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$PROOF_NAME" --restart unless-stopped --memory 2g -p "127.0.0.1:$PROOF_PORT:6300" "$image" >/dev/null
    log "proof server: $image"
  fi
}

crons() {
  [ "${TAIL_JUDGE_NO_CRON:-}" = 1 ] && { log "crons not installed (TAIL_JUDGE_NO_CRON=1)"; return 0; }
  local slot="$1" off
  case "$slot" in C) off=2 ;; D) off=3 ;; E) off=4 ;; *) die "slot C, D or E" ;; esac
  local me="$HOME_DIR/judge.sh"
  { crontab -l 2>/dev/null | grep -v '# tail-judge$' || true
    echo "55 21 * * * $me record >> $HOME_DIR/logs/record.log 2>&1 # tail-judge"
    echo "$off-59/5 22-23 * * * $me attest >> $HOME_DIR/logs/attest.log 2>&1 # tail-judge"
    echo "$((17 + off)) 12 * * * $me update >> $HOME_DIR/logs/update.log 2>&1 # tail-judge"
  } | crontab -
  log "crons: record 21:55 UTC, attest every 5 min from :0$off (22:00-23:59 UTC), update daily"
}

case "${1:-}" in
  setup)
    slot="${2:-}"; [[ "$slot" =~ ^[CDE]$ ]] || die "usage: judge.sh setup <slot C|D|E> (the slot the operator gave you)"
    checks
    p=$(pointer); tag=$(field tag <<<"$p"); verify_release "$tag" "$(field pot <<<"$p")" "$(field gameHash <<<"$p")" "$(field version <<<"$p")"
    field release < "releases/$tag/tail-the-pup-patrol/judge-current.json" > "$HOME_DIR/release-floor.tmp" && mv -f "$HOME_DIR/release-floor.tmp" "$HOME_DIR/release-floor"
    ln -sfn "releases/$tag" current.tmp && mv -T current.tmp current
    cp current/tail-the-pup-patrol/pot/judge.sh "$HOME_DIR/judge.sh"; chmod +x "$HOME_DIR/judge.sh"
    env_file "$slot"; proof_server
    . ./judge.env
    pot_dir=current/tail-the-pup-patrol/pot
    [ -f "$KEYS" ] || (cd "$pot_dir" && node judge-key.mjs "$KEYS" "$slot")
    [ -f "$WALLET" ] || ( umask 077; node -e "console.log(JSON.stringify({ seed: require('crypto').randomBytes(32).toString('hex') }))" > "$WALLET" )
    crons "$slot"
    echo
    echo "== Send the operator your PUBLIC judge key (never the file):"
    (cd "$pot_dir" && node judge-key.mjs "$KEYS" "$slot" 2>/dev/null | grep -io "[0-9a-f]\{64\}" | head -1) || true
    echo "== Your fee wallet (get it some tNIGHT, then: $HOME_DIR/judge.sh status):"
    (cd "$pot_dir" && TAIL_POT_WALLET="$WALLET" node status.mjs 2>/dev/null | grep -o "mn_addr_preview1[0-9a-z]*" | head -1) || true
    echo "== Once funded, register it for DUST: (cd $HOME_DIR/$pot_dir && TAIL_POT_WALLET=$WALLET node status.mjs fund)"
    ;;
  update)
    checks
    [ -f judge.env ] || die "run setup first"
    . ./judge.env
    p=$(pointer); tag=$(field tag <<<"$p")
    if [ "$(readlink current)" = "releases/$tag" ]; then log "up to date: $tag"; exit 0; fi
    # Never backwards: the pointer is unsigned, so it may not move you to an older pot or season than the
    # signed release you're on (whose own pointer says what that is).
    cur=current/tail-the-pup-patrol/judge-current.json
    nv=$(field version <<<"$p"); ns=$(field season <<<"$p"); cv=$(field version < "$cur"); cs=$(field season < "$cur")
    [[ "$nv$ns$cv$cs" =~ ^[0-9]+$ ]] || die "the pointer is malformed"
    if [ "$nv" -lt "$cv" ] || { [ "$nv" -eq "$cv" ] && [ "$ns" -lt "$cs" ]; }; then die "the pointer names an older pot or season ($tag) than the one you're on: not going back"; fi
    verify_release "$tag" "$(field pot <<<"$p")" "$(field gameHash <<<"$p")" "$(field version <<<"$p")"
    switch_to "$tag"; env_file "$TAIL_JUDGE_SLOT"; proof_server
    ;;
  status)
    [ -f judge.env ] || die "run setup first"
    . ./judge.env
    echo "running: $(readlink current) (slot $TAIL_JUDGE_SLOT)"
    pub=$(cd current/tail-the-pup-patrol/pot && node judge-key.mjs "$KEYS" "$TAIL_JUDGE_SLOT" 2>/dev/null | grep -io "[0-9a-f]\{64\}" | head -1 || true)
    v=$(field version < current/tail-the-pup-patrol/judge-current.json)
    out=$(cd current/tail-the-pup-patrol/pot && TAIL_POT_CONTRACT="tail-pot-v$v" node verify.mjs "$(field address < "$TAIL_POT_DEPLOYMENT")" 2>&1 || true)
    grep "^judge" <<<"$out" || true
    if [ -n "$pub" ] && grep -q "$pub" <<<"$out"; then echo "your key holds a slot: your outcomes count"; else echo "your key isn't in a slot yet: send the operator your public key"; fi
    (cd current/tail-the-pup-patrol/pot && node status.mjs 2>/dev/null | tail -3) || true
    tail -2 logs/attest.log 2>/dev/null || true
    ;;
  record)
    [ -f judge.env ] || die "run setup first"
    cd current/tail-the-pup-patrol
    exec node record.mjs --scheduled "$(date -u +%FT22:00:00Z)" --out "$HOME_DIR/runs/$(date -u +%F).json"
    ;;
  attest)
    [ -f judge.env ] || die "run setup first"
    . ./judge.env
    cd current/tail-the-pup-patrol/pot
    run=$(node call-v3.mjs run-id | cut -d' ' -f1)
    file="$HOME_DIR/runs/$(date -u +%F).json"
    [ -f "$file" ] || { log "no recording $file yet"; exit 0; }
    out=$(node call-v3.mjs attest "$TAIL_JUDGE_SLOT" "$run" "$file" 2>&1) && rc=0 || rc=$?
    { grep -v "RPC-CORE\|^\s*at " <<<"$out" || true; } | tail -4
    grep -q "already attested this outcome\|already agreed" <<<"$out" && rc=0
    exit $rc
    ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
