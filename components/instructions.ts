import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { ResumeSection } from "@/types";

/**
 * Plain-language "what should I do on this screen?" copy.
 *
 * Every funnel step and every follow-up screen shows one of these at the top
 * (see `InstructionBanner`). Written for readers with low literacy: short
 * sentences, everyday words, no jargon, and always an "out" (you can skip / it
 * doesn't have to be perfect) so nobody gets stuck.
 */
export interface StepInstruction {
  icon: string;
  title: string;
  body: string;
}

const BY_SECTION: Record<ResumeSection, StepInstruction> = {
  career_goal: {
    icon: "🎯",
    title: "¿Qué trabajo quieres?",
    body: "Dinos qué trabajo te gustaría tener. Escribe con tus palabras. No importa si no estás seguro.",
  },
  personal_information: {
    icon: "👤",
    title: "Tus datos",
    body: "Escribe tu nombre y cómo pueden encontrarte: tu teléfono o tu correo.",
  },
  education: {
    icon: "📚",
    title: "Lo que estudiaste",
    body: "Cuéntanos qué estudiaste. Sirve la escuela, un curso corto o algo que aprendiste. Si no estudiaste, puedes saltar este paso.",
  },
  experience: {
    icon: "🛠️",
    title: "Lo que has hecho",
    body: "Cuéntanos algo que hayas hecho: un trabajo, un negocio, cuidar a alguien o ayudar sin pago. Todo cuenta.",
  },
  skills: {
    icon: "⭐",
    title: "Lo que sabes hacer",
    body: "Marca lo que sí sabes hacer. Quita lo que no. Solo ponemos lo que tú digas.",
  },
  certifications: {
    icon: "📜",
    title: "Tus diplomas",
    body: "¿Tienes algún diploma o certificado? Escríbelo aquí. Si no tienes, puedes saltar este paso.",
  },
  languages: {
    icon: "🗣️",
    title: "Idiomas que hablas",
    body: "Dinos qué idiomas hablas y cuánto: un poco, más o menos, o bien.",
  },
  projects: {
    icon: "💡",
    title: "Cosas que hiciste",
    body: "Cuéntanos algo que hayas hecho o arreglado tú mismo. Puede ser en tu casa, tu barrio o un curso.",
  },
  achievements: {
    icon: "🏆",
    title: "Tus logros",
    body: "Cuéntanos algo que hiciste bien y que te puso orgulloso. Grande o pequeño, todo sirve.",
  },
  review: {
    icon: "✅",
    title: "Revisa tu información",
    body: "Lee lo que escribiste. Cambia o borra lo que quieras. Cuando esté bien, aprieta el botón para crear tu currículum.",
  },
};

const FALLBACK: StepInstruction = {
  icon: "✍️",
  title: "Cuéntanos más",
  body: "Responde con tus palabras. No tiene que ser perfecto.",
};

const SKILL_CONFIRM: StepInstruction = {
  icon: "⭐",
  title: "Confirma lo que sabes",
  body: 'Te mostramos cosas que creemos que sabes hacer. Aprieta "Confirmar" si es verdad. Aprieta "No incluir" si no lo es.',
};

/** Pick the right instruction for the current funnel question/step. */
export function stepInstruction(question: AdaptiveQuestion): StepInstruction {
  if (question.inputType === "skill_confirmation") return SKILL_CONFIRM;
  if (question.inputType === "review" || question.nextAction === "review_profile") {
    return BY_SECTION.review;
  }
  return BY_SECTION[question.section] ?? FALLBACK;
}
