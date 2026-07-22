import { ReferenceStudySchema, type ReferenceStudy } from "@mcdev/assets-contracts";

export interface ReferenceAnalysisThresholds {
  readonly minStudies: number;
  readonly minIndependentProjects: number;
  readonly minIndependentSubjects: number;
  readonly minRuleSupport: number;
}

export interface ReferenceRuleCandidate {
  readonly id: string;
  readonly projectSupport: number;
  readonly promotable: boolean;
}

export interface ReferenceCatalogReport {
  readonly readyForRulePromotion: boolean;
  readonly studyCount: number;
  readonly independentProjects: number;
  readonly independentSubjects: number;
  readonly candidateRules: readonly ReferenceRuleCandidate[];
  readonly diagnostics: readonly { readonly id: string; readonly message: string }[];
}

const DEFAULT_THRESHOLDS: ReferenceAnalysisThresholds = Object.freeze({
  minStudies: 3,
  minIndependentProjects: 3,
  minIndependentSubjects: 3,
  minRuleSupport: 2,
});

function parseStudies(inputs: readonly unknown[]): readonly ReferenceStudy[] {
  return inputs.map((input, index) => {
    const result = ReferenceStudySchema.safeParse(input);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new TypeError(`Invalid ReferenceStudy at index ${index} (${issue?.message ?? "validation failed"}).`);
    }
    return result.data;
  });
}

/** Prevents one admired mod from becoming the generator's only design authority. */
export function analyzeReferenceCatalog(
  inputs: readonly unknown[],
  assetClass: ReferenceStudy["subject"]["assetClass"],
  thresholds: ReferenceAnalysisThresholds = DEFAULT_THRESHOLDS,
): ReferenceCatalogReport {
  const studies = parseStudies(inputs).filter(({ subject }) => subject.assetClass === assetClass);
  const projects = new Set(studies.map(({ source }) => source.repository));
  const subjects = new Set(studies.map(({ source, subject }) => `${source.repository}#${subject.id}`));
  const diagnostics: Array<{ id: string; message: string }> = [];
  if (studies.length < thresholds.minStudies) diagnostics.push({
    id: "REFERENCE_STUDY_COUNT_LOW",
    message: `Expected ${thresholds.minStudies} ${assetClass} studies, received ${studies.length}.`,
  });
  if (projects.size < thresholds.minIndependentProjects) diagnostics.push({
    id: "REFERENCE_PROJECT_DIVERSITY_LOW",
    message: `Expected ${thresholds.minIndependentProjects} independent projects, received ${projects.size}.`,
  });
  if (subjects.size < thresholds.minIndependentSubjects) diagnostics.push({
    id: "REFERENCE_SUBJECT_DIVERSITY_LOW",
    message: `Expected ${thresholds.minIndependentSubjects} independent subjects, received ${subjects.size}.`,
  });

  const ruleProjects = new Map<string, Set<string>>();
  for (const study of studies) {
    for (const rule of study.derivedRules.filter(({ appliesTo }) => appliesTo.includes(assetClass))) {
      const support = ruleProjects.get(rule.id) ?? new Set<string>();
      support.add(study.source.repository);
      ruleProjects.set(rule.id, support);
    }
  }
  const candidateRules = [...ruleProjects.entries()]
    .map(([id, support]) => Object.freeze({
      id,
      projectSupport: support.size,
      promotable: support.size >= thresholds.minRuleSupport,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!candidateRules.some(({ promotable }) => promotable)) diagnostics.push({
    id: "REFERENCE_RULE_SUPPORT_LOW",
    message: `No derived rule is supported by ${thresholds.minRuleSupport} independent projects.`,
  });
  return Object.freeze({
    readyForRulePromotion: diagnostics.length === 0,
    studyCount: studies.length,
    independentProjects: projects.size,
    independentSubjects: subjects.size,
    candidateRules: Object.freeze(candidateRules),
    diagnostics: Object.freeze(diagnostics),
  });
}
