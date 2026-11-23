# Candy Cane Canyon original-source Sugar Fizz — ten-biome sound review room

Standalone static listener snapshot from game implementation draft PR #271 (issue #270), stacked upon Vertigo #268, Jellyfish #265, Steampunk #263 and consolidated five-biome integration #261. This static page is main-based draft PR #201; it is NOT another game implementation and NOT a released/approved sound.

**Source provenance:** this snapshot reuses the five EXISTING unchanged, synchronized original-instrument 20-second **Pope MP3** preview files by a relative URL to PR201's neighboring Scrapheap stem directory. No OGG, MP3, WAV or original media were copied/altered. The game uses original OGG release stems. Numerical offline QA used the DIFFERENT original One More Run OGG recording; never equate those RMS/peak figures to Pope.

**Actual mechanic:** Candy Cane Canyon has Sugar Rush speedMul 1.3 and air steerMul 0.8 while ground steering remains fully effective per Marvin's prior decision. Audio merely observes real rider speed and actual grounded/airborne/valid landing events, changing NO original physics, notes, tempo or separate MIDI leads. sugarfizz preserves unity dry original audio with separate source-fed speed-dependent candy brightness/fizz. True takeoff has one short candy wrapper CRRRT, valid landing a distinct POP-KRRRRK candy crackle, physical waveforms even when recorded stems fall quiet. No fabricated beat grid or musical notes.

**First-listen proposals, NOT Marvin approval:** sweetness 125%, speed-fizz 150%, pop-crackle 130%, wrapper 90%; test speed 1600-1800 px/s. Solo drums and dry A/B are provided, as are physical event demonstration buttons.

**Real OGG QA:** 304 focused tests in 30 suites, 483 determinism cases in 18 suites, Vite 528 modules, original One More Run real Web Audio Chromium production-game nine-processor integration test. Real Chromium 48kHz 3.5-second original OGG: original dry RMS .0814, idle wet delta 3.90%, high speed ground delta 23.47%, high speed airborne delta 25.00%, POP landing delta 15.88%, wrapper delta 8.88%. Corrected full-speed airborne raw sample peak .9868 after initial clipping had been found; these are short-window signal/peak figures, not full-song/device or human listening acceptance.

This candidate is pending owner ears and independent review before any production merge. The existing browser-only feedback tracker should allow verdicts/notes without sending them to any server.
