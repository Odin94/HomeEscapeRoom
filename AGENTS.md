# Gameplay and room effects

Room effects must never block player input or puzzle completion, including text, number, color, symbol, QR, voice, and external answers. Accept valid answers and reveal the next challenges immediately while effects run, wait, or await retry.

When progress schedules new effects, let them replace current or pending effects on the same devices. Preserve unrelated effects until their configured interruption condition or a later command replaces them. Superseded effects must not resume or overwrite newer commands on retry.
