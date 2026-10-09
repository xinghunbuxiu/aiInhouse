# Floor-plan AI pipeline: accuracy first, cost-aware by default

## Why a single expensive vision call is not enough

A strong multimodal model can interpret symbols and spatial context, but it should not be treated as a CAD engine or a source of exact measurements. Keep visual interpretation, geometry extraction, validation, and rendering as separate responsibilities.

## Recommended pipeline

1. **Normalize the source**: preserve the original image; deskew, denoise, improve contrast, and retain a mapping from processed pixels back to source coordinates. For PDFs, extract the embedded text layer before OCR.
2. **Local geometry pass**: use OpenCV line/contour/morphology candidates and the existing wall/door/window detectors. This pass is cheap and deterministic; it supplies candidate geometry rather than final truth.
3. **One multimodal semantic pass**: send the original image plus focused high-resolution crops for small labels/symbols only when available. Ask for strict structured JSON with room labels, evidence, confidence, and unresolved ambiguities. Do not ask the model to invent precise dimensions.
4. **Deterministic fusion**: match labels only to regions that contain their centers; use wall topology and symbol evidence to reconcile room boundaries. Preserve special spaces such as elevator shafts, pipe shafts, equipment platforms, entry foyers, and balconies as first-class types.
5. **Geometry validation**: check wall intersections, room overlap, impossible areas, opening-to-wall alignment, room connectivity, duplicate labels, scale consistency, and bounds. Use code for arithmetic and constraints.
6. **Conditional recovery pass**: call the more capable/expensive model only when quality gates fail or when high-impact conflicts remain. Send the smallest relevant crops and a short list of specific conflicts, not the whole prompt/context again.
7. **Human correction**: present low-confidence walls, openings, and room types as editable overlays. Save corrections as structured ground truth for regression tests and future model tuning.
8. **3D and panorama**: compile the corrected geometry into a deterministic scene graph first. Add furniture/materials after topology is locked. Render genuine equirectangular panoramas from the 3D scene, then create Pannellum scenes/hotspots; never treat a generated configuration or a flat preview as proof that a 360-degree panorama exists.

## Cost controls

- Keep the normal recognition path to one vision-model request; only run a probe/review request after a weak result.
- Cache by image content hash, preprocessing version, prompt/schema version, and model identifier. A path/mtime-only cache can miss duplicate images and does not express prompt/model changes.
- Use low-detail images for plan classification and route uncertain regions to high/original detail only when the provider supports it.
- Crop label-heavy or symbol-heavy regions instead of repeatedly sending the entire high-resolution sheet.
- Keep model choice configurable. Use a cheaper model for classification/semantic extraction and reserve the strongest model for ambiguous/high-value cases.
- Record provider, model, input size, latency, cache hit, retry count, and estimated cost per job; never log API keys or raw private floorplans unnecessarily.

## Quality gates before producing a customer-facing 3D tour

- All high-impact room labels are grounded to visible labels or clearly documented inference.
- Elevator shafts and equipment zones cannot become bathrooms due to nearby OCR.
- Door/window candidates align with wall openings.
- Geometry is connected and room overlaps/intersections are within explicit tolerances.
- Source dimensions and scale assumptions are explicit; inferred dimensions are not presented as exact.
- A valid 3D scene loads; panorama images exist, have 2:1 equirectangular dimensions, and load in the viewer.
- Low-confidence results remain marked as review-required rather than being silently advertised as accurate.

## Evaluation loop

Maintain a fixed set of varied plans (marketing brochures, clean CAD exports, low-resolution scans, plans with elevators/shafts, angled walls, and dense dimensions). Track room recall/precision, label accuracy, wall/opening alignment, topology violations, scale error, end-to-end success, latency, and cost per plan. Every user correction that fixes a structural error should become a regression fixture.
