<script lang="ts">
    import HospitalPage from "$lib/components/map/HospitalPage.svelte";

    let { data } = $props();
</script>

<HospitalPage map={data.map} editable />
