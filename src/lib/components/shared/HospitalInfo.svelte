<script lang="ts">
    import { answerParts, type FaqEntry } from "$lib/model/faq";
    let { faq }: { faq: FaqEntry[] } = $props();
</script>

<div class="hospital-info">
    {#each faq as entry, i (i)}<details>
            <summary>{entry.question}</summary>
            <p>
                {#each answerParts(entry.answer) as part}{#if part.tel}<a href={`tel:${part.tel}`}>{part.text}</a
                        >{:else}{part.text}{/if}{/each}
            </p>
        </details>{/each}
</div>

<style>
    .hospital-info {
        display: flex;
        flex-direction: column;
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
