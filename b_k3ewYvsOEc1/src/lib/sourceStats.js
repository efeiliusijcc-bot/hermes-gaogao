function count(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : null
}

export function getTruthfulSourceStats(data, visibleSourceCount) {
  const diagnostics = data?.diagnostics || {}

  return {
    initialCandidates:
      count(diagnostics.vectorCandidateCount) ??
      count(data?.vectorPlan?.vectorHits),
    fusedCandidates: count(diagnostics.mergedCandidateCount),
    selectedSources:
      count(diagnostics.acceptedCount) ??
      arrayCount(data?.acceptedSources) ??
      arrayCount(data?.sources),
    visibleSources: count(visibleSourceCount),
  }
}
