The user has just completed a roadmap task. The task description is: $ARGUMENTS

Instructions:
1. Read ROADMAP.md
2. Find the line that best matches the description in $ARGUMENTS (fuzzy match — the user may have paraphrased). Look for a `- [ ]` checkbox line containing those keywords.
3. If you find a clear match, change `- [ ]` to `- [x]` for that line using the Edit tool.
4. If the match is ambiguous (multiple candidates), show the candidates and ask the user which one to mark.
5. After marking, report:
   - Which item was marked complete (quote the line)
   - The next unchecked item in the same phase
   - Updated phase progress (X / N done)

If $ARGUMENTS is empty, read ROADMAP.md, show the first 10 unchecked items across all phases, and ask the user which one to mark complete.
