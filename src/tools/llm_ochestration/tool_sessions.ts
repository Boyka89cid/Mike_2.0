export type ListDomainsSessionState = {
  session_id: string;
  exec_name?: string;
  step?: string;
};



export type ReadDomainSessionState = {
  session_id: string;
  step?: string;
  display_name?: string;
  domain_slug?: string; // resolved internally from display_name
  query?: string;
  fetched_chunks?: Record<string, any>[];    // stored server-side between FETCH and GENERATE
  fetched_domain_context?: Record<string, any>; // stored server-side between FETCH and GENERATE
  response?: string;
  chunks_used?: string[];
};

export type KnowledgeEntry = {
  content: string;
  category: string;
  tags: string[];
};

export type CreateDomainSessionState = {
  session_id: string;
  step?: string;
  area_of_business?: string;
  questions_with_this_domain?: string[];
  scope_of_domain?: { covers: string[], not_covers: string[]};
  extra_details?: string;
  user_confirmation?: boolean;
  knowledge_entries?: KnowledgeEntry[];
};

export type AddContentSessionState = {
  session_id: string;
  step?: string;
  display_name?: string;
  //domain_slug?: string;
  content?: string;
  category?: string;
  tags?: string[];
};