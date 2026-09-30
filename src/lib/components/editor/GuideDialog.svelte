<script lang="ts">
    let { onclose }: { onclose: () => void } = $props();
</script>

<div
    class="guide-backdrop"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && onclose()}
>
    <div class="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <button class="guide-close" aria-label="Close guide" onclick={onclose}>×</button>
        <small>P-MAP EDITOR · QUICK GUIDE</small>
        <h2 id="guide-title">Build a hospital map in four steps</h2>
        <ol class="guide-steps">
            <li>
                <b>Place buildings</b>
                <span
                    >Pick an asset in the library and click the ground. <em>Templates</em> arrive
                    with rooms inside.</span
                >
            </li>
            <li>
                <b>Connect them</b>
                <span>Lay corridors so they touch a building wall — a door is added automatically.</span>
            </li>
            <li>
                <b>Add rooms</b>
                <span
                    >Select a building, choose a room type and click its floor plan. Pick the wall
                    the door is on.</span
                >
            </li>
            <li>
                <b>Check wayfinding</b>
                <span
                    >The <em>Wayfinding</em> tab tests routes and flags rooms nobody can reach. Then
                    open the map to share it.</span
                >
            </li>
        </ol>
        <div class="guide-keys">
            <span><kbd>Esc</kbd> stop placing / deselect</span>
            <span><kbd>R</kbd> rotate</span>
            <span><kbd>D</kbd> duplicate</span>
            <span><kbd>Del</kbd> delete</span>
            <span><kbd>⌘Z</kbd> undo</span>
            <span><kbd>⇧⌘Z</kbd> redo</span>
        </div>
        <p class="guide-note">
            Every change is saved to the database as you work and is live for visitors straight away.
            Use Export for a copy of the layout.
        </p>
        <button class="btn primary" onclick={onclose}>Start building</button>
    </div>
</div>
