# Demo recording for the README.
#
#   brew install vhs
#   vhs docs/demo.tape
#
# Regenerate whenever the brief's output changes. The point of the recording is
# the "Due soon, no day assigned" section — that is the one screenful that
# explains what the tool is for, so it must be visible in the final frame.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1000
Set Height 620
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms
Set PlaybackSpeed 1.0

Hide
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 600ms
Type "marvin"
Sleep 400ms
Enter
Sleep 4s

Type "marvin capture 'book the dentist +tomorrow'"
Sleep 400ms
Enter
Sleep 2500ms

Type "marvin complete 'migration plan'"
Sleep 400ms
Enter
Sleep 3s

Sleep 2s
