<script lang="ts">
    import { answerParts, byTopic, type FaqEntry } from "$lib/model/faq";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let { faq }: { faq: FaqEntry[] } = $props();
    const locale = useLocale();
    let groups = $derived(byTopic(faq));
</script>

<div class="hospital-info">
    {#each groups as g (g.topic.id)}<section aria-label={g.topic.name[locale.lang]}>
            {#if groups.length > 1}<h3>{g.topic.name[locale.lang]}</h3>{/if}
            {#each g.entries as entry, i (i)}<details>
                    <summary>{entry.question}</summary>
                    <p>
                        {#each answerParts(entry.answer) as part}{#if part.tel}<a href={`tel:${part.tel}`}
                                    >{part.text}</a
                                >{:else}{part.text}{/if}{/each}
                    </p>
                </details>{/each}
        </section>{/each}
</div>

<style>
    .hospital-info {
        display: flex;
        flex-direction: column;
    }
    h3 {
        margin: 14px 0 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    section:first-child h3 {
        margin-top: 0;
    }
    details {
        border-bottom: 1px solid #eef2ea;
    }
    details:last-child {
        border-bottom: 0;
    }
    summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 0;
        list-style: none;
        cursor: pointer;
        font-weight: 600;
        color: #1f3a2b;
        line-height: 1.35;
    }
    summary::-webkit-details-marker {
        display: none;
    }
    summary::after {
        content: "";
        flex-shrink: 0;
        width: 7px;
        height: 7px;
        margin-right: 4px;
        border-right: 2px solid #7b8c70;
        border-bottom: 2px solid #7b8c70;
        transform: translateY(-2px) rotate(45deg);
        transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    details[open] summary::after {
        transform: translateY(2px) rotate(-135deg);
    }
    p {
        margin: 0 0 14px;
        white-space: pre-line;
        line-height: 1.5;
        color: #2f4336;
    }
    a {
        color: #2f6b8f;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
        summary::after {
            transition: none;
        }
    }
</style>
