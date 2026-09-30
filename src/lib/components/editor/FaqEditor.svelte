<script lang="ts">
    import { MAX_ANSWER, MAX_FAQ, MAX_QUESTION, topicOf, topics, type FaqEntry, type TopicId } from "$lib/model/faq";
    let {
        faq,
        topic,
        onchange,
    }: {
        /** All the questions; only this topic's are shown. */
        faq: FaqEntry[];
        topic: TopicId;
        onchange: (faq: FaqEntry[]) => void;
    } = $props();
    let info = $derived(topics.find((t) => t.id === topic)!);
    // Indexes into `faq`, so edits keep the order of the other topics.
    let shown = $derived(faq.flatMap((e, i) => (topicOf(e) === topic ? [i] : [])));
    // Starter questions not asked yet, offered as one-click starts.
    let starters = $derived(info.starters.filter((q) => !faq.some((e) => e.question === q)));
    const setEntry = (i: number, patch: Partial<FaqEntry>) =>
        onchange(faq.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    function add(question = "") {
        if (faq.length < MAX_FAQ) onchange([...faq, { question, answer: "", topic }]);
    }
    /** Swap with the previous or next question of the same topic. */
    function move(n: number, by: number) {
        const next = [...faq],
            [a, b] = [shown[n], shown[n + by]];
        [next[a], next[b]] = [next[b], next[a]];
        onchange(next);
    }
</script>

<div class="faq-editor">
    {#each shown as i, n (i)}{@const entry = faq[i]}<div class="entry">
            <div class="entry-head">
                <small>Question {n + 1}</small>
                <select
                    aria-label="Topic of question {n + 1}"
                    value={topic}
                    onchange={(e) => setEntry(i, { topic: e.currentTarget.value as TopicId })}
                    >{#each topics as t}<option value={t.id}>{t.name.id}</option>{/each}</select
                ><button aria-label="Move question {n + 1} up" disabled={n === 0} onclick={() => move(n, -1)}>↑</button
                ><button
                    aria-label="Move question {n + 1} down"
                    disabled={n === shown.length - 1}
                    onclick={() => move(n, 1)}>↓</button
                ><button
                    class="remove"
                    aria-label="Remove question {n + 1}"
                    onclick={() => onchange(faq.filter((_, j) => j !== i))}>×</button
                >
            </div>
            <input
                aria-label="Question {n + 1}"
                maxlength={MAX_QUESTION}
                placeholder="e.g. Bolehkah anak-anak ikut menjenguk?"
                value={entry.question}
                onchange={(e) => setEntry(i, { question: e.currentTarget.value })}
            /><textarea
                aria-label="Answer {n + 1}"
                rows="4"
                maxlength={MAX_ANSWER}
                placeholder="The answer visitors see. Phone numbers can be tapped to call."
                value={entry.answer}
                onchange={(e) => setEntry(i, { answer: e.currentTarget.value })}
            ></textarea>
            {#if !entry.question.trim() || !entry.answer.trim()}<p class="draft">
                    Hidden from visitors until it has both a question and an answer.
                </p>{/if}
        </div>{:else}<p class="empty">No questions about {info.name.en.toLowerCase()} yet.</p>{/each}
    {#if starters.length && faq.length < MAX_FAQ}<div class="starters">
            <small>Common questions</small>
            {#each starters as q}<button class="chip" onclick={() => add(q)}>+ {q}</button>{/each}
        </div>{/if}
    <button class="btn add" disabled={faq.length >= MAX_FAQ} onclick={() => add()}>+ Add question</button>
    {#if faq.length >= MAX_FAQ}<p class="draft">That's the most questions a map can hold ({MAX_FAQ}).</p>{/if}
</div>

<style>
    .entry {
        border: 1px solid #dfe6d8;
        border-radius: 10px;
        padding: 10px 12px 12px;
        margin-bottom: 10px;
        background: white;
    }
    .entry-head {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .entry-head small {
        flex: 1;
        font-size: 11px;
        color: #738466;
    }
    .entry-head select {
        margin-right: 6px;
        padding: 3px 6px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        background: white;
        font: inherit;
        font-size: 11px;
        color: #52664a;
    }
    .entry-head button {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        font-size: 12px;
        color: #52664a;
    }
    .entry-head button:disabled {
        opacity: 0.35;
    }
    .entry-head .remove {
        color: #9a4d3c;
        font-size: 16px;
    }
    input,
    textarea {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #dce3d4;
        border-radius: 6px;
        margin: 6px 0 0;
        background: white;
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        resize: vertical;
    }
    input {
        font-weight: 600;
    }
    .draft,
    .empty {
        margin: 6px 0 0;
        font-size: 11px;
        color: #9a7a3c;
    }
    .empty {
        margin: 0 0 12px;
        color: #738466;
    }
    .starters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 4px 0 10px;
    }
    .starters small {
        width: 100%;
        font-size: 10px;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    .chip {
        padding: 6px 10px;
        border: 1px dashed #c9d4c0;
        border-radius: 14px;
        font-size: 12px;
        color: #3f5a45;
        text-align: left;
    }
    .add {
        width: 100%;
        justify-content: center;
        font-size: 12px;
    }
</style>
