#!/bin/bash
# Quick push script - auto commit and push

# Get commit message from argument or use default
MESSAGE="${1:-Update code}"

echo "📦 Adding files..."
git add -A

echo "💾 Committing: $MESSAGE"
git commit -m "$MESSAGE"

echo "🚀 Pushing to remote..."
git push

echo "✅ Done!"
