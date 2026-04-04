#!/bin/bash
cd /root/runway/apps/web

# Version bump: read current, increment patch
PKG_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$PKG_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

# Update package.json version
sed -i "s/\"version\": \"${PKG_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
echo "✓ version bumped: ${PKG_VERSION} → ${NEW_VERSION}"

npx vite build

# Generate version.json with changelog
# Usage: pass changelog as arguments, or edit CHANGELOG array below
CHANGELOG=${CHANGELOG:-'[]'}

cat > dist/version.json << EOF
{
  "v": "$(date +%s)",
  "version": "${NEW_VERSION}",
  "changelog": ${CHANGELOG}
}
EOF

echo "✓ version.json created: $(cat dist/version.json)"
