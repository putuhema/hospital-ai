<script lang="ts">
    import { faqTopics, MAX_ANSWER, MAX_FAQ, MAX_QUESTION, type FaqEntry } from "$lib/model/faq";
    let {
        faq,
        onchange,
    }: {
        faq: FaqEntry[];
        onchange: (faq: FaqEntry[]) => void;
    } = $props();
    // Topics not asked yet, offered as one-click starts.
    let topics = $derived(faqTopics.filter((t) => !faq.some((e) => e.question === t.question)));
    const setEntry = (i: number, patch: Partial<FaqEntry>) =>
        onchange(faq.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    function add(question = "") {
        if (faq.length < MAX_FAQ) onchange([...faq, { question, answer: "" }]);
    }
    function move(i: number, by: number) {
        const next = [...faq];
        [next[i], next[i + by]] = [next[i + by], next[i]];
        onchange(next);
    }
</script>

<div class="faq-editor">
    <p class="hint">
        General questions the map can't answer. Visitors find them under <b>Hospital information</b>,
        and they go online when you publish. Questions without an answer stay hidden.
    </p>
    {#each faq as entry, i}<div class="entry">
            <div class="entry-head">
                <small>Question {i + 1}</small>
                <button aria-label="Move question {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button
                ><button
                    aria-label="Move question {i + 1} down"
                    disabled={i === faq.length - 1}
                    onclick={() => move(i, 1)}>↓</button
                ><button
                    class="remove"
                    aria-label="Remove question {i + 1}"
                    onclick={() => onchange(faq.filter((_, j) => j !== i))}>×</button
                >
            </div>
            <input
                aria-label="Question {i + 1}"
                maxlength={MAX_QUESTION}
                placeholder="e.g. Bolehkah anak-anak ikut menjenguk?"
                value={entry.question}
                onchange={(e) => setEntry(i, { question: e.currentTarget.value })}
            /><textarea
                aria-label="Answer {i + 1}"
                rows="3"
                maxlength={MAX_ANSWER}
                placeholder="The answer visitors see"
                value={entry.answer}
                onchange={(e) => setEntry(i, { answer: e.currentTarget.value })}
            ></textarea>
        </div>{/each}
    {#if topics.length && faq.length < MAX_FAQ}<div class="topics">
            {#each topics as t}<button class="chip" onclick={() => add(t.question)}>+ {t.label}</button>{/each}
        </div>{/if}
    <button class="btn add" disabled={faq.length >= MAX_FAQ} onclick={() => add()}>+ Add question</button>
</div>

<style>
    .hint {
        font-size: 11px;
        color: #738466;
        line-height: 1.5;
        margin: 0 0 10px;
    }
    .hint b {
        color: #3f5a45;
    }
    .entry {
        border: 1px solid #dfe6d8;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        background: #fbfcf8;
    }
    .entry-head {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .entry-head small {
        flex: 1;
        font-size: 10px;
        color: #738466;
    }
    .entry-head button {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        font-size: 12px;
        color: #52664a;
    }
    .entry-head button:disabled {
        opacity: 0.35;
    }
    .entry-head .remove {
        color: #9a4d3c;
        font-size: 15px;
    }
    input,
    textarea {
        display: block;
        width: 100%;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        margin: 5px 0 0;
        background: white;
        font: inherit;
        font-size: 12px;
        resize: vertical;
    }
    input {
        font-weight: 600;
    }
    .topics {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
    }
    .chip {
        padding: 5px 9px;
        border: 1px dashed #c9d4c0;
        border-radius: 14px;
        font-size: 11px;
        color: #3f5a45;
    }
    .add {
        width: 100%;
        justify-content: center;
        font-size: 11px;
        margin-bottom: 8px;
    }
</style>
