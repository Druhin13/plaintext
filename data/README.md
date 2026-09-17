# Cover sentence bank

`cover-sentences.json` stores curated visible cover text for automatic mode.

Each language is split into `short`, `medium`, and `long` buckets so the picker can vary output length without generating text at runtime.

Current status:

- English: 108 sentences (36 short, 36 medium, 36 long)
- Other supported languages: to be added in separate passes

The site is not wired to this data yet. Automatic generation still uses the existing implementation until the remaining language banks are ready and the picker is introduced.
