#!/bin/bash

# Deploy Script for Silent Watch

# Check if a commit message was provided
if [ -z "$1" ]; then
  echo "Error: No commit message provided."
  echo "Usage: ./deploy.sh \"Your commit message\""
  exit 1
fi

COMMIT_MSG="$1"

echo "-----------------------------------"
echo "Starting Deployment Process"
echo "-----------------------------------"

# 1. Add all changes
echo "Step 1: Adding changes to Git..."
git add .
if [ $? -ne 0 ]; then
    echo "Error: Failed to add files."
    exit 1
fi

# 2. Commit changes
echo "Step 2: Committing changes..."
git commit -m "$COMMIT_MSG"
# Check if commit failed (e.g., nothing to commit), but allow proceeding if it's just empty
if [ $? -ne 0 ]; then
    echo "Warning: Commit command returned error (maybe nothing to commit?). Proceeding..."
fi

# 3. Push to GitHub
echo "Step 3: Pushing to GitHub..."
# Assuming 'main' branch, but good to check. 
# For now, we'll push HEAD to the upstream tracking branch.
git push
if [ $? -ne 0 ]; then
    echo "Error: Git push failed."
    exit 1
fi

# 4. Deploy to Firebase
echo "Step 4: Deploying to Firebase Hosting..."
firebase deploy
if [ $? -ne 0 ]; then
    echo "Error: Firebase deploy failed."
    exit 1
fi

echo "-----------------------------------"
echo "Deployment Complete!"
echo "-----------------------------------"
