# Cover sentence bank

`cover-sentences.json` stores the curated English cover text used by Automatic mode.

The bank currently contains 108 sentences split into three length buckets:

- 36 short
- 36 medium
- 36 long

`lib/sentence-bank.ts` chooses a length at random, then picks a sentence from that bucket while avoiding recently used sentences.

There is no runtime text model, external generation request, or language-generation layer. Automatic cover selection is entirely local and immediate.
