export type NavigationMeasure = {
  repeatStart?: boolean;
  repeatEnd?: true | number;
  volta?: number[];
  voltaPasses?: number[];
  segno?: boolean;
  coda?: boolean;
  toCoda?: boolean;
  fine?: boolean;
  jump?: "ds" | "dc";
  jumpMode?: "coda" | "fine";
};

export type PlaybackOrderResult = {
  order: number[];
  warnings: string[];
  valid: boolean;
};

type RepeatState = { start: number; pass: number };
type CompletedRepeat = RepeatState;
type CodaRoute = { at: number; target: number };
type RepeatSection = { id: number; start: number; exit: number; total: number };

const MAX_ORDER = 10_000;

export const compilePlaybackOrder = (measures: readonly NavigationMeasure[]): PlaybackOrderResult => {
  const warningSet = new Set<string>();
  const warn = (message: string) => warningSet.add(message);
  const segnos: number[] = [];
  const codas: number[] = [];
  const repeatTotals: (number | undefined)[] = [];
  const voltaPasses: (Set<number> | undefined)[] = [];

  measures.forEach((measure, index) => {
    if (measure.segno) segnos.push(index);
    if (measure.coda) codas.push(index);

    if (measure.repeatEnd === undefined) repeatTotals.push(undefined);
    else if (measure.repeatEnd === true) repeatTotals.push(2);
    else if (Number.isSafeInteger(measure.repeatEnd) && measure.repeatEnd >= 2 && measure.repeatEnd <= 16) repeatTotals.push(measure.repeatEnd);
    else {
      repeatTotals.push(2);
      warn(`Measure ${index + 1} has an invalid repeat count; using 2.`);
    }

    const rawPasses = [...(measure.volta ?? []), ...(measure.voltaPasses ?? [])];
    const passes = rawPasses.filter(pass => Number.isSafeInteger(pass) && pass >= 1);
    if (passes.length !== rawPasses.length) warn(`Measure ${index + 1} has an invalid volta pass.`);
    voltaPasses.push(passes.length ? new Set(passes) : undefined);
    if (measure.jumpMode && !measure.jump) warn(`Measure ${index + 1} has al ${measure.jumpMode} without D.S. or D.C.`);
  });

  const previous = (indices: readonly number[], before: number) => {
    for (let i = indices.length - 1; i >= 0; i -= 1) if (indices[i] < before) return indices[i];
    return undefined;
  };
  const dsTargets = new Map<number, number>();
  const codaRoutes = new Map<number, CodaRoute>();
  measures.forEach((measure, index) => {
    if (!measure.jump) return;
    let jumpTarget = measure.jump === "dc" ? 0 : undefined;
    let toCoda: number | undefined;
    if (measure.jumpMode === "coda") {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (measures[i].toCoda && (measure.jump === "dc" || previous(segnos, i) !== undefined)) {
          toCoda = i;
          break;
        }
      }
      const coda = codas.find(candidate => candidate > index);
      if (toCoda === undefined) warn(`al Coda at measure ${index + 1} has no usable To Coda before it.`);
      if (coda === undefined) warn(`al Coda at measure ${index + 1} has no Coda after it.`);
      if (toCoda !== undefined && coda !== undefined) codaRoutes.set(index, { at: toCoda, target: coda });
    }
    if (measure.jump === "ds") {
      const target = previous(segnos, measure.jumpMode === "coda" && toCoda !== undefined ? toCoda : index);
      if (target === undefined) warn(`D.S. at measure ${index + 1} has no preceding Segno.`);
      else {
        jumpTarget = target;
        dsTargets.set(index, target);
      }
    }
    if (measure.jumpMode === "fine" && jumpTarget !== undefined
      && !measures.some((candidate, candidateIndex) => candidateIndex >= jumpTarget! && candidate.fine)) {
      warn(`al Fine at measure ${index + 1} has no reachable Fine.`);
    }
  });

  const sections: RepeatSection[] = [];
  const sectionByEnd = new Map<number, RepeatSection>();
  const sectionByVolta: (RepeatSection | undefined)[] = [];
  const openStarts: number[] = [];
  for (let index = 0; index < measures.length; index += 1) {
    if (measures[index].repeatStart) openStarts.push(index);
    if (voltaPasses[index]) {
      let exit = index + 1;
      while (exit < measures.length && voltaPasses[exit]) exit += 1;
      const ends: number[] = [];
      for (let current = index; current < exit; current += 1) {
        if (repeatTotals[current] !== undefined) ends.push(current);
      }
      if (ends.length) {
        const written = [...new Set(ends.flatMap(end => typeof measures[end].repeatEnd === "number" ? [measures[end].repeatEnd] : []))];
        const highestPass = Math.max(...voltaPasses.slice(index, exit).flatMap(passes => passes ? [...passes] : []));
        if (written.length > 1) warn(`Volta at measure ${index + 1} has conflicting repeat counts.`);
        const total = written[0] ?? Math.max(2, highestPass);
        if (total < highestPass) warn(`Volta at measure ${index + 1} needs pass ${highestPass}, but the repeat count is ${total}.`);
        const section = { id: sections.length, start: openStarts.pop() ?? 0, exit, total };
        sections.push(section);
        ends.forEach(end => sectionByEnd.set(end, section));
        for (let current = index; current < exit; current += 1) sectionByVolta[current] = section;
      } else warn(`Volta at measure ${index + 1} has no repeat end.`);
      index = exit - 1;
      continue;
    }
    const total = repeatTotals[index];
    if (total !== undefined) {
      const section = { id: sections.length, start: openStarts.pop() ?? 0, exit: index + 1, total };
      sections.push(section);
      sectionByEnd.set(index, section);
    }
  }
  if (openStarts.length) warn("A repeat start has no repeat end.");

  const order: number[] = [];
  const repeats: RepeatState[] = [];
  const completed = new Map<number, CompletedRepeat>();
  const usedJumps = new Set<number>();
  const usedToCodas = new Set<number>();
  const seen = new Set<string>();
  const maxSteps = Math.max(MAX_ORDER * 2, measures.length * 2);
  let pc = 0;
  let steps = 0;
  let lastPass = 1;
  let fineArmed = false;
  let codaRoute: CodaRoute | undefined;

  const signature = () => JSON.stringify([
    pc,
    repeats.map(repeat => [repeat.start, repeat.pass]),
    [...completed].sort(([a], [b]) => a - b).map(([end, repeat]) => [end, repeat.start, repeat.pass]),
    [...usedJumps].sort((a, b) => a - b),
    [...usedToCodas].sort((a, b) => a - b),
    lastPass,
    fineArmed,
    codaRoute ? [codaRoute.at, codaRoute.target] : null,
  ]);

  const finishRepeat = (section: RepeatSection, missingEnd = false) => {
    const alreadyCompleted = completed.get(section.id);
    if (alreadyCompleted) {
      lastPass = alreadyCompleted.pass;
      let active = repeats.length - 1;
      while (active >= 0 && repeats[active].start !== alreadyCompleted.start) active -= 1;
      if (active >= 0) repeats.splice(active);
      pc = section.exit;
      return;
    }

    let repeat: RepeatState | undefined = repeats[repeats.length - 1];
    if (!repeat || repeat.start !== section.start) {
      let active = repeats.length - 1;
      while (active >= 0 && repeats[active].start !== section.start) active -= 1;
      if (active >= 0) {
        repeats.splice(active + 1);
        repeat = repeats[active];
      } else repeat = undefined;
    }
    if (!repeat) {
      repeat = { start: section.start, pass: 1 };
      repeats.push(repeat);
    }
    if (repeat.pass < section.total) {
      if (missingEnd) warn(`Repeat pass ${repeat.pass} from measure ${section.start + 1} has no reachable repeat end.`);
      repeat.pass += 1;
      lastPass = repeat.pass;
      for (const [nestedId, nested] of completed) {
        const nestedSection = sections[nestedId];
        if (nestedSection.exit <= section.exit && nested.start >= repeat.start) completed.delete(nestedId);
      }
      pc = repeat.start;
      return;
    }

    lastPass = repeat.pass;
    completed.set(section.id, { ...repeat });
    repeats.pop();
    pc = section.exit;
  };

  const advance = () => {
    const section = sectionByVolta[pc];
    if (section && pc + 1 === section.exit) finishRepeat(section, true);
    else pc += 1;
  };

  while (pc >= 0 && pc < measures.length) {
    if (order.length >= MAX_ORDER) {
      warn(`Playback order exceeded ${MAX_ORDER} measures and was truncated.`);
      break;
    }
    if (steps++ >= maxSteps) {
      warn("Playback exceeded the safety step limit and was stopped.");
      break;
    }
    const state = signature();
    if (seen.has(state)) {
      warn("Playback navigation contains a loop and was stopped.");
      break;
    }
    seen.add(state);

    const measure = measures[pc];
    if (measure.repeatStart) {
      const prior = [...completed.values()].find(repeat => repeat.start === pc);
      if (prior) lastPass = prior.pass;
      else if (!repeats.some(repeat => repeat.start === pc)) repeats.push({ start: pc, pass: 1 });
    }

    const pass = repeats[repeats.length - 1]?.pass ?? lastPass;
    const plays = !voltaPasses[pc] || voltaPasses[pc]!.has(pass);
    if (plays) order.push(pc);

    const repeatTotal = repeatTotals[pc];
    if (!plays) {
      advance();
      continue;
    }

    if (fineArmed && measure.fine) break;

    if (codaRoute && pc === codaRoute.at && measure.toCoda && !usedToCodas.has(pc)) {
      usedToCodas.add(pc);
      const target = codaRoute.target;
      codaRoute = undefined;
      repeats.length = 0;
      pc = target;
      continue;
    }

    if (measure.jump && !usedJumps.has(pc)) {
      usedJumps.add(pc);
      const target = measure.jump === "dc" ? 0 : dsTargets.get(pc);
      if (target !== undefined) {
        fineArmed ||= measure.jumpMode === "fine";
        codaRoute ||= codaRoutes.get(pc);
        repeats.length = 0;
        pc = target;
        continue;
      }
    }

    if (repeatTotal !== undefined) finishRepeat(sectionByEnd.get(pc)!);
    else advance();
  }

  const warnings = [...warningSet];
  return { order, warnings, valid: warnings.length === 0 };
};
