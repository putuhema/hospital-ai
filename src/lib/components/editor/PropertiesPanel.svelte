<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import { answered, type FaqEntry } from "$lib/model/faq";
    import { isArea, isBarrier, isBuilding, isGate, isParking, isPath, pieceType } from "$lib/model/interiors";
    import ColorField from "$lib/components/shared/ColorField.svelte";
    import InteriorEditor from "./InteriorEditor.svelte";
    import DestinationsEditor from "./DestinationsEditor.svelte";
    import EntranceEditor from "./EntranceEditor.svelte";
    import PlaceInfoEditor from "./PlaceInfoEditor.svelte";
    import PositionFields from "./PositionFields.svelte";
    import ProjectOverview from "./ProjectOverview.svelte";
    import Icon from "./Icon.svelte";
    let {
        piece,
        placing = false,
        pieces,
        canvasWidth,
        canvasHeight,
        greenery = $bindable(),
        hidden,
        faq,
        update,
        edit,
        onrotate,
        onduplicate,
        onremove,
        onguide,
        onexportmodel,
        onnotify,
    }: {
        /** The selected piece, if any, or the piece about to be placed. */
        piece: Piece | undefined;
        /** `piece` isn't on the canvas yet: it's being set up before placing. */
        placing?: boolean;
        pieces: Piece[];
        canvasWidth: number;
        canvasHeight: number;
        /** Trees and foliage around the campus on the visitor map. */
        greenery: number;
        hidden: boolean;
        /** Hospital information, edited on its own page (/editor/info). */
        faq: FaqEntry[];
        /** Set one property, with the editor's checks (sizes, doors, rooms). */
        update: (key: keyof Piece, value: string | number | undefined) => void;
        /** Apply changes to the selected piece as they are. */
        edit: (changes: Partial<Piece>) => void;
        onrotate: () => void;
        onduplicate: () => void;
        onremove: () => void;
        onguide: () => void;
        onexportmodel: () => void;
        onnotify: (message: string) => void;
    } = $props();
    // Model colours (sRGB) of the Blender materials, used as "Reset" targets.
    const defaultRoof = (kind: string) =>
        kind === "pitched" ? "#4f9497" : kind === "flat" ? "#ebeeea" : "#a9b5b2";
    const roofStyles = [
        ["pitched", "Pitched"],
        ["flat", "Flat"],
    ];
    const shapes = [
        [undefined, "Box"],
        ["L", "L-shape"],
    ] as const;
    /** A custom roof colour, or none when it matches the model's own. */
    const roofColor = (p: Piece, c: string) => (c === defaultRoof(p.kind) ? undefined : c);
</script>

<aside class="inspector" id="properties-panel" aria-label="Properties" {hidden}>
    <div class="section-heading">
        <h2>Properties</h2>
        <span>⚙</span>
    </div>
    {#if piece}<div class="selected-heading">
            <div class="selected-icon" style={`background:${piece.color}`}>
                <Icon name="building" size={23} />
            </div>
            <div>
                <b>{piece.name}</b><small
                    >{pieceType(piece)} <span>·</span>
                    {placing ? "Before placing" : "Selected"}</small
                >
            </div>
        </div>
        {#if placing}<p class="hint">
                Turn and adjust it here, then click the ground to place it. Each click places a copy
                with these settings; <kbd>Esc</kbd> stops placing.
            </p>{/if}
        <label class="field"
            >Name<input value={piece.name} onchange={(e) => update("name", e.currentTarget.value)} /></label
        >
        <details class="section" open>
            <summary>Appearance</summary>
            {#if isBuilding(piece)}<div class="style-row">
                    <span>Roof</span>
                    <div class="segmented" role="group" aria-label="Roof style">
                        {#each roofStyles as [kind, label]}<button
                                class:active={piece.kind === kind}
                                aria-pressed={piece.kind === kind}
                                onclick={() => update("kind", kind)}>{label}</button
                            >{/each}
                    </div>
                </div>
                <div class="style-row">
                    <span>Shape</span>
                    <div class="segmented" role="group" aria-label="Building shape">
                        {#each shapes as [shape, label]}<button
                                class:active={piece.shape === shape}
                                aria-pressed={piece.shape === shape}
                                onclick={() => update("shape", shape)}>{label}</button
                            >{/each}
                    </div>
                </div>
                <div class="style-row">
                    <span>Storeys</span>
                    <div class="stepper">
                        <button
                            aria-label="Fewer storeys"
                            disabled={(piece.floors ?? 1) <= 1}
                            onclick={() => update("floors", (piece.floors ?? 1) - 1)}>−</button
                        ><b>{piece.floors ?? 1}</b><button
                            aria-label="More storeys"
                            disabled={(piece.floors ?? 1) >= 4}
                            onclick={() => update("floors", (piece.floors ?? 1) + 1)}>+</button
                        >
                    </div>
                </div>
                <ColorField
                    label="Walls"
                    value={piece.color}
                    fallback="#d3ddd0"
                    onchange={(c) => update("color", c)}
                />
                <ColorField
                    label="Roof"
                    value={piece.roofColor ?? defaultRoof(piece.kind)}
                    fallback={defaultRoof(piece.kind)}
                    onchange={(c) => update("roofColor", roofColor(piece, c))}
                />
                <p class="hint">Storeys change the outside look. Directions use the ground floor.</p>{:else if isPath(piece)}<ColorField
                    label="Paving"
                    value={piece.color}
                    fallback="#cfc6b4"
                    onchange={(c) => update("color", c)}
                />
                <p class="hint">Open-air path: no roof. Routes prefer it over crossing the grass.</p>{:else if isParking(piece)}<ColorField
                    label="Surface"
                    value={piece.color}
                    fallback="#7c8286"
                    onchange={(c) => update("color", c)}
                />
                <p class="hint">
                    Open-air parking: no building. Visitors can search for it and get directions
                    to it, and start a route from where they parked.
                </p>{:else if isGate(piece)}<ColorField
                    label="Drive"
                    value={piece.color}
                    fallback="#b9b2a3"
                    onchange={(c) => update("color", c)}
                />
                <p class="hint">
                    The way into the campus. Its name is written on the gateway, and visitors can
                    search for it as an entrance. Traffic crosses its short side.
                </p>{:else if isBarrier(piece)}<ColorField
                    label="Lane"
                    value={piece.color}
                    fallback="#6f7579"
                    onchange={(c) => update("color", c)}
                />
                <p class="hint">
                    Ticket booth and barrier arm. Put it across the way into a car park; traffic
                    crosses its short side. Visitors can search for it as an entrance and exit.
                    Turn it twice to put the booth on the other side.
                </p>{:else}<ColorField
                    label="Floor"
                    value={piece.color}
                    fallback="#d9d4c9"
                    onchange={(c) => update("color", c)}
                />
                <ColorField
                    label="Canopy"
                    value={piece.roofColor ?? defaultRoof(piece.kind)}
                    fallback={defaultRoof(piece.kind)}
                    onchange={(c) => update("roofColor", roofColor(piece, c))}
                />{/if}
        </details>
        {#if isBuilding(piece)}<details class="section" open>
                <summary>Rooms <span class="badge">{piece.roomAssets?.length ?? 0}</span></summary>
                <InteriorEditor building={piece} onchange={(roomAssets) => edit({ roomAssets })} />
                <details class="sub">
                    <summary
                        >Other destinations <span class="badge">{piece.rooms?.length ?? 0}</span></summary
                    >
                    <DestinationsEditor
                        rooms={piece.rooms ?? []}
                        onchange={(rooms) => edit({ rooms })}
                        {onnotify}
                    />
                </details>
            </details>
            {#if !placing}<details class="section">
                <summary>Visitor info</summary>
                <PlaceInfoEditor info={piece.info} onchange={(info) => edit({ info })} />
            </details>
            <details class="section">
                <summary>Doors & entrances</summary>
                <EntranceEditor
                    building={piece}
                    {pieces}
                    onchange={(entrances) => edit({ entrances })}
                    {onnotify}
                />
            </details>{/if}{/if}
        {#if isArea(piece) && !placing}<details class="section">
                <summary>Visitor info</summary>
                <PlaceInfoEditor info={piece.info} onchange={(info) => edit({ info })} />
            </details>{/if}
        <details class="section" open={placing}>
            <summary>{placing ? "Size & rotation" : "Position & size"}</summary>
            <PositionFields {piece} {placing} {canvasWidth} {canvasHeight} {update} {onrotate} />
        </details>
        {#if !placing}<div class="object-actions">
            <button class="btn" onclick={onduplicate}><Icon name="copy" size={15} /> Duplicate</button
            ><button class="btn delete" title="Delete selected object" onclick={onremove}
                ><Icon name="trash" size={16} /></button
            >
        </div>{/if}{:else}<div class="empty getting-started">
            <b>Getting started</b>
            <ol>
                <li>Pick a building or template from the library</li>
                <li>Click the ground to place it</li>
                <li>Join buildings with corridors — doors appear automatically</li>
                <li>Select a building to add rooms</li>
                <li>Open the wayfinding map to find your way</li>
            </ol>
            <button class="btn" onclick={onguide}>Open quick guide</button>
        </div>
        <a class="section info-link" href="/editor/info"
            ><b>Hospital information</b><span
                >Questions & answers and doctors' schedules · {answered(faq).length} live</span
            ></a
        >{/if}
    <ProjectOverview {pieces} {canvasWidth} {canvasHeight} bind:greenery {onexportmodel} />
</aside>

<style>
    .info-link {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 12px 0;
        border-top: 1px solid #e9ece3;
        text-decoration: none;
        font-size: 12px;
        color: #33473a;
    }
    .info-link span {
        font-size: 11px;
        color: #738466;
    }
    .info-link b::after {
        content: " →";
        color: #9ba58e;
    }
</style>
