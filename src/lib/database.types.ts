/**
 * Supabase 数据库类型定义（public schema）。
 *
 * ⚠️ 手写维护：本实例 `supabase gen types` 依赖 Docker（postgres-meta 容器），
 * 当前开发机未装 Docker，故按 `supabase/migrations/` 的 schema 手写。
 * 改表后请同步更新此文件；后续接入 CI/Docker 可改回自动生成：
 *   supabase gen types typescript --db-url "<conn>" --schema public > src/lib/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          nickname: string;
          avatar_url: string | null;
          current_family_id: string | null;
          last_login_at: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          nickname: string;
          avatar_url?: string | null;
          current_family_id?: string | null;
          last_login_at?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nickname?: string;
          avatar_url?: string | null;
          current_family_id?: string | null;
          last_login_at?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      families: {
        Row: {
          id: string;
          name: string;
          cover_url: string | null;
          owner_user_id: string;
          timezone: string;
          member_count: number;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          cover_url?: string | null;
          owner_user_id: string;
          timezone: string;
          member_count?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          cover_url?: string | null;
          owner_user_id?: string;
          timezone?: string;
          member_count?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          family_id: string;
          user_id: string;
          role: string;
          status: string;
          joined_at: string;
          left_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          user_id: string;
          role: string;
          status?: string;
          joined_at?: string;
          left_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          joined_at?: string;
          left_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          family_id: string | null;
          name: string;
          icon: string | null;
          type: string;
          is_system: boolean;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id?: string | null;
          name: string;
          icon?: string | null;
          type: string;
          is_system?: boolean;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string | null;
          name?: string;
          icon?: string | null;
          type?: string;
          is_system?: boolean;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      family_hidden_categories: {
        Row: {
          family_id: string;
          category_id: string;
          created_at: string;
        };
        Insert: {
          family_id: string;
          category_id: string;
          created_at?: string;
        };
        Update: {
          family_id?: string;
          category_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      savings_goals: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          target_amount: number;
          deadline: string | null;
          cover_url: string | null;
          note: string | null;
          saved_amount: number;
          achieved_at: string | null;
          status: string;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          target_amount: number;
          deadline?: string | null;
          cover_url?: string | null;
          note?: string | null;
          saved_amount?: number;
          achieved_at?: string | null;
          status?: string;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          target_amount?: number;
          deadline?: string | null;
          cover_url?: string | null;
          note?: string | null;
          saved_amount?: number;
          achieved_at?: string | null;
          status?: string;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          family_id: string;
          type: string;
          amount: number;
          category_id: string;
          note: string | null;
          occurred_at: string;
          recorder_user_id: string;
          source: string;
          savings_goal_id: string | null;
          sync_status: string;
          is_deleted: boolean;
          created_at: string;
          updated_at: string;
          last_editor_user_id: string | null;
        };
        Insert: {
          id?: string;
          family_id: string;
          type: string;
          amount: number;
          category_id: string;
          note?: string | null;
          occurred_at?: string;
          recorder_user_id: string;
          source?: string;
          savings_goal_id?: string | null;
          sync_status?: string;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
          last_editor_user_id?: string | null;
        };
        Update: {
          id?: string;
          family_id?: string;
          type?: string;
          amount?: number;
          category_id?: string;
          note?: string | null;
          occurred_at?: string;
          recorder_user_id?: string;
          source?: string;
          savings_goal_id?: string | null;
          sync_status?: string;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
          last_editor_user_id?: string | null;
        };
        Relationships: [];
      };
      savings_entries: {
        Row: {
          id: string;
          goal_id: string;
          direction: string;
          amount: number;
          note: string | null;
          transaction_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          goal_id: string;
          direction: string;
          amount: number;
          note?: string | null;
          transaction_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          goal_id?: string;
          direction?: string;
          amount?: number;
          note?: string | null;
          transaction_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      budgets: {
        Row: {
          id: string;
          family_id: string;
          period: string;
          total_amount: number;
          alert_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          period: string;
          total_amount: number;
          alert_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          period?: string;
          total_amount?: number;
          alert_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      budget_categories: {
        Row: {
          id: string;
          budget_id: string;
          category_id: string;
          amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          category_id: string;
          amount: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          category_id?: string;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          family_id: string;
          code: string;
          expires_at: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          code: string;
          expires_at: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          code?: string;
          expires_at?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      succession_requests: {
        Row: {
          id: string;
          family_id: string;
          applicant_user_id: string;
          objection_deadline: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          applicant_user_id: string;
          objection_deadline: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          applicant_user_id?: string;
          objection_deadline?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          channel: string;
          payload: Json | null;
          read_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          channel: string;
          payload?: Json | null;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          channel?: string;
          payload?: Json | null;
          read_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      feedback: {
        Row: {
          id: string;
          user_id: string;
          family_id: string | null;
          type: string;
          content: string;
          image_paths: string[];
          contact_ok: boolean;
          device: Json;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          family_id?: string | null;
          type: string;
          content: string;
          image_paths?: string[];
          contact_ok?: boolean;
          device?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          family_id?: string | null;
          type?: string;
          content?: string;
          image_paths?: string[];
          contact_ok?: boolean;
          device?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          family_activity: boolean;
          budget_alert: boolean;
          savings_progress: boolean;
          monthly_summary: boolean;
          member_change: boolean;
          account_security: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          family_activity?: boolean;
          budget_alert?: boolean;
          savings_progress?: boolean;
          monthly_summary?: boolean;
          member_change?: boolean;
          account_security?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          family_activity?: boolean;
          budget_alert?: boolean;
          savings_progress?: boolean;
          monthly_summary?: boolean;
          member_change?: boolean;
          account_security?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      device_tokens: {
        Row: {
          token: string;
          user_id: string;
          platform: string;
          provider: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          token: string;
          user_id: string;
          platform: string;
          provider?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          token?: string;
          user_id?: string;
          platform?: string;
          provider?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      monthly_summaries: {
        Row: {
          id: string;
          family_id: string;
          period: string;
          total_expense: number;
          total_income: number;
          balance: number;
          max_single_expense: Json | null;
          top_category: Json | null;
          top_recorder: Json | null;
          mom_compare: Json | null;
          warm_text: string | null;
          generated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          period: string;
          total_expense?: number;
          total_income?: number;
          balance?: number;
          max_single_expense?: Json | null;
          top_category?: Json | null;
          top_recorder?: Json | null;
          mom_compare?: Json | null;
          warm_text?: string | null;
          generated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          period?: string;
          total_expense?: number;
          total_income?: number;
          balance?: number;
          max_single_expense?: Json | null;
          top_category?: Json | null;
          top_recorder?: Json | null;
          mom_compare?: Json | null;
          warm_text?: string | null;
          generated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      accounting_preferences: {
        Row: {
          user_id: string;
          default_txn_type: string;
          after_record_behavior: string;
          amount_privacy: boolean;
          report_card_order: string[];
          report_card_hidden: string[];
          show_monthly_summary_entry: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          default_txn_type?: string;
          after_record_behavior?: string;
          amount_privacy?: boolean;
          report_card_order?: string[];
          report_card_hidden?: string[];
          show_monthly_summary_entry?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          default_txn_type?: string;
          after_record_behavior?: string;
          amount_privacy?: boolean;
          report_card_order?: string[];
          report_card_hidden?: string[];
          show_monthly_summary_entry?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurring_transactions: {
        Row: {
          id: string;
          family_id: string;
          type: string;
          amount: number;
          category_id: string;
          note: string | null;
          recorder_user_id: string;
          created_by: string;
          day_of_month: number;
          frequency: string;
          start_date: string;
          end_date: string | null;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          type: string;
          amount: number;
          category_id: string;
          note?: string | null;
          recorder_user_id: string;
          created_by: string;
          day_of_month: number;
          frequency?: string;
          start_date: string;
          end_date?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          type?: string;
          amount?: number;
          category_id?: string;
          note?: string | null;
          recorder_user_id?: string;
          created_by?: string;
          day_of_month?: number;
          frequency?: string;
          start_date?: string;
          end_date?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurring_runs: {
        Row: {
          id: string;
          rule_id: string;
          period_key: string;
          transaction_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          rule_id: string;
          period_key: string;
          transaction_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          rule_id?: string;
          period_key?: string;
          transaction_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      generate_due_recurring_transactions: {
        Args: Record<string, never>;
        Returns: number;
      };
      create_family: {
        Args: { p_name: string; p_timezone: string };
        Returns: Database['public']['Tables']['families']['Row'];
      };
      create_invitation: {
        Args: { p_force_new?: boolean };
        Returns: Database['public']['Tables']['invitations']['Row'];
      };
      join_family_by_code: {
        Args: { p_code: string };
        Returns: Database['public']['Tables']['families']['Row'];
      };
      preview_family_by_code: {
        Args: { p_code: string };
        Returns: Json;
      };
      savings_deposit: {
        Args: { p_goal_id: string; p_amount: number; p_note: string; p_expected_version: number };
        Returns: Database['public']['Tables']['savings_goals']['Row'];
      };
      savings_withdraw: {
        Args: { p_goal_id: string; p_amount: number; p_note: string; p_expected_version: number };
        Returns: Database['public']['Tables']['savings_goals']['Row'];
      };
      delete_savings_goal: {
        Args: { p_goal_id: string };
        Returns: undefined;
      };
      transfer_ownership: {
        Args: { p_new_owner: string };
        Returns: Database['public']['Tables']['families']['Row'];
      };
      remove_member: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      leave_family: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      dissolve_family: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      delete_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      submit_feedback: {
        Args: {
          p_type: string;
          p_content: string;
          p_image_paths?: string[];
          p_contact_ok?: boolean;
          p_device?: Json;
        };
        Returns: string;
      };
      register_device_token: {
        Args: {
          p_token: string;
          p_platform: string;
          p_provider?: string;
        };
        Returns: undefined;
      };
      unregister_device_token: {
        Args: {
          p_token: string;
        };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// 便捷别名
type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
