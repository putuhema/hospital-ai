<script lang="ts">
    import HospitalPage from "$lib/components/map/HospitalPage.svelte";

    // The hospital at its public address, as printed on the QR signs.
    let { data } = $props();
</script>

<HospitalPage map={data.map} />
