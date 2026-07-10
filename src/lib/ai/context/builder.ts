export interface AIContext {

  message: string;

  customer: {

    id?: string;

    name?: string;

    phone?: string;

  };

  business: {

    spaName: string;

    city: string;

  };

  memory: string[];

  knowledge: string[];

}

export async function buildContext(
  message: string,
): Promise<AIContext> {

  return {

    message,

    customer: {

      id: undefined,

      name: undefined,

      phone: undefined,

    },

    business: {

      spaName: "Relaxio Spa",

      city: "Lucknow",

    },

    memory: [],

    knowledge: [],

  };

}