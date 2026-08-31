# Motion contract — C-DOCUMENT-RUNTIME-RELIABILITY-235-V3

## Decision

Transport normalization, classified connection failures, package-cache publication, installer rejection and repair results use **no motion**. Their meaning must be complete in the static state.

## Existing busy feedback

The existing connection button may retain its current restrained busy indication while the request is active. It must not resize, move the form or delay cancellation/error handling.

- state transition: at most 120–180 ms opacity/background change;
- no bounce, shake, scale pulse, blur or progress animation with a fabricated percentage;
- repeated clicks remain disabled only while the same request is unresolved;
- focus is preserved independently of transition completion.

## Reduced motion

With `prefers-reduced-motion: reduce`:

- status and busy states switch immediately;
- no smooth scroll or translated error entrance is introduced;
- no save, upload or installer operation waits for an animation event;
- the same text, focus and retry action remain available.

## Installer

Terminal stages are represented by ordered lines and exit status only. Spinners, animated progress bars and time estimates are not added. A package or OCR failure prints the failing stage and exits before application staging.
