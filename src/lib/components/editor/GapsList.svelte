<script lang="ts" generics="Row extends Omit<Gap, 'topic'> & { topic: string; _id: string }">
    import { topics } from "$lib/model/faq";
    import { asked, type Gap } from "$lib/assistant/gaps";

    let {
        gaps,
        onanswer,
        ondone,
    }: {
        /** Most asked first, as `gaps.list` returns them. */
        gaps: Row[];
        /** Start an answer under the topic, with the question visitors asked. */
        onanswer: (gap: Row) => void;
        ondone: (gap: Row) => void;
    } = $props();
    const topicName = (id: string) => topics.find((t) => t.id === id)?.name.id ?? id;
    // Read once a minute, so "today 14.20" turns into "yesterday" on a page left open.
    let now = $state(Date.now());
    $effect(() => {
        const timer = setInterval(() => (now = Date.now()), 60_000);
        return () => clearInterval(timer);
    });
</script>

<ol class="gaps">
    {#each gaps as gap (gap._id)}<li>
            <div class="head">
                <span class="count" title="Asked {gap.count} time{gap.count === 1 ? '' : 's'}">{gap.count}×</span>
                <h3>{gap.subject}</h3>
                <span class="topic">{topicName(gap.topic)}</span>
                <small>last asked {asked(gap.lastAt, now)}</small>
            </div>
            <ul class="asked">
                {#each gap.questions as q}<li>“{q}”</li>{/each}
            </ul>
            <div class="actions">
                <button class="btn primary" onclick={() => onanswer(gap)}>Write an answer</button>
                <button class="btn" onclick={() => ondone(gap)} title="Hide it until a visitor asks again">Mark as done</button>
            </div>
        </li>{:else}<p class="empty">
            Nothing yet. When AIRMA can't answer a visitor, the question shows up here, counted, so you can add the
            answer.
        </p>{/each}
</ol>

<style>
    .gaps {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .gaps > li {
        padding: 14px 16px;
        border: 1px solid #dfe6d8;
        border-radius: 12px;
        background: white;
    }
    .head {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
    }
    .count {
        min-width: 34px;
        padding: 2px 7px;
        border-radius: 999px;
        background: #2d4a38;
        color: white;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }
    h3 {
        margin: 0;
        font-size: 16px;
    }
    .topic {
        padding: 1px 8px;
        border-radius: 999px;
        background: #eef4ea;
        color: #3f5a45;
        font-size: 11px;
    }
    small {
        margin-left: auto;
        color: #7b8c70;
        font-size: 12px;
    }
    .asked {
        margin: 10px 0 12px;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: #4b5d47;
    }
    .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .btn {
        padding: 7px 12px;
        border: 1px solid #d3dccb;
        border-radius: 8px;
        background: white;
        color: #2f4336;
        font-size: 12px;
    }
    .btn.primary {
        border-color: #2d4a38;
        background: #2d4a38;
        color: white;
    }
    .empty {
        color: #738466;
        font-size: 13px;
        line-height: 1.5;
    }
</style>
