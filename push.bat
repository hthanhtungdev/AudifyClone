@echo off
REM Quick push script for Windows

SET MESSAGE=%*
IF "%MESSAGE%"=="" SET MESSAGE=Update code

echo Adding files...
git add -A

echo Committing: %MESSAGE%
git commit -m "%MESSAGE%"

echo Pushing to remote...
git push

echo Done!
