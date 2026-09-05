export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      accounting_preferences: {
        Row: {
          after_record_behavior: string;
          amount_privacy: boolean;
          created_at: string;
          default_txn_type: string;
          report_card_hidden: string[];
          report_card_order: string[];
          show_monthly_summary_entry: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          after_record_behavior?: string;
          amount_privacy?: boolean;
          created_at?: string;
          default_txn_type?: string;
          report_card_hidden?: string[];
          report_card_order?: string[];
          show_monthly_summary_entry?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          after_record_behavior?: string;
          amount_privacy?: boolean;
          created_at?: string;
          default_txn_type?: string;
          report_card_hidden?: string[];
          report_card_order?: string[];
          show_monthly_summary_entry?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'accounting_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_categories: {
        Row: {
          amount: number;
          budget_id: string;
          category_id: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          budget_id: string;
          category_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          budget_id?: string;
          category_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_categories_budget_id_fkey';
            columns: ['budget_id'];
            isOneToOne: false;
            referencedRelation: 'budgets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_categories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      budgets: {
        Row: {
          alert_enabled: boolean;
          created_at: string;
          family_id: string;
          id: string;
          period: string;
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          alert_enabled?: boolean;
          created_at?: string;
          family_id: string;
          id?: string;
          period: string;
          total_amount: number;
          updated_at?: string;
        };
        Update: {
          alert_enabled?: boolean;
          created_at?: string;
          family_id?: string;
          id?: string;
          period?: string;
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budgets_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          color_key: string | null;
          created_at: string;
          family_id: string | null;
          icon: string | null;
          id: string;
          is_system: boolean;
          name: string;
          status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          color_key?: string | null;
          created_at?: string;
          family_id?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          color_key?: string | null;
          created_at?: string;
          family_id?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      device_tokens: {
        Row: {
          created_at: string;
          locale: string;
          platform: string;
          provider: string;
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          locale?: string;
          platform: string;
          provider?: string;
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          locale?: string;
          platform?: string;
          provider?: string;
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'device_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      families: {
        Row: {
          avatar_url: string | null;
          cover_url: string | null;
          created_at: string;
          id: string;
          member_count: number;
          name: string;
          owner_user_id: string;
          slogan: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          cover_url?: string | null;
          created_at?: string;
          id?: string;
          member_count?: number;
          name: string;
          owner_user_id: string;
          slogan?: string;
          status?: string;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          cover_url?: string | null;
          created_at?: string;
          id?: string;
          member_count?: number;
          name?: string;
          owner_user_id?: string;
          slogan?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'families_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      family_data_revisions: {
        Row: {
          family_id: string;
          revision: number;
          updated_at: string;
        };
        Insert: {
          family_id: string;
          revision?: number;
          updated_at?: string;
        };
        Update: {
          family_id?: string;
          revision?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'family_data_revisions_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: true;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      family_hidden_categories: {
        Row: {
          category_id: string;
          created_at: string;
          family_id: string;
        };
        Insert: {
          category_id: string;
          created_at?: string;
          family_id: string;
        };
        Update: {
          category_id?: string;
          created_at?: string;
          family_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'family_hidden_categories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_hidden_categories_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback: {
        Row: {
          contact_ok: boolean;
          content: string;
          created_at: string;
          device: Json;
          family_id: string | null;
          id: string;
          image_paths: string[];
          status: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          contact_ok?: boolean;
          content: string;
          created_at?: string;
          device?: Json;
          family_id?: string | null;
          id?: string;
          image_paths?: string[];
          status?: string;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          contact_ok?: boolean;
          content?: string;
          created_at?: string;
          device?: Json;
          family_id?: string | null;
          id?: string;
          image_paths?: string[];
          status?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          code: string;
          created_at: string;
          expires_at: string;
          family_id: string;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          expires_at: string;
          family_id: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          expires_at?: string;
          family_id?: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          family_id: string;
          id: string;
          joined_at: string;
          left_at: string | null;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          family_id: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          role: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          family_id?: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      monthly_summaries: {
        Row: {
          balance: number;
          created_at: string;
          family_id: string;
          generated_at: string;
          id: string;
          max_single_expense: Json | null;
          mom_compare: Json | null;
          period: string;
          top_category: Json | null;
          top_recorder: Json | null;
          total_expense: number;
          total_income: number;
          updated_at: string;
          warm_text: string | null;
        };
        Insert: {
          balance?: number;
          created_at?: string;
          family_id: string;
          generated_at?: string;
          id?: string;
          max_single_expense?: Json | null;
          mom_compare?: Json | null;
          period: string;
          top_category?: Json | null;
          top_recorder?: Json | null;
          total_expense?: number;
          total_income?: number;
          updated_at?: string;
          warm_text?: string | null;
        };
        Update: {
          balance?: number;
          created_at?: string;
          family_id?: string;
          generated_at?: string;
          id?: string;
          max_single_expense?: Json | null;
          mom_compare?: Json | null;
          period?: string;
          top_category?: Json | null;
          top_recorder?: Json | null;
          total_expense?: number;
          total_income?: number;
          updated_at?: string;
          warm_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'monthly_summaries_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          account_security: boolean;
          budget_alert: boolean;
          created_at: string;
          family_activity: boolean;
          member_change: boolean;
          monthly_summary: boolean;
          savings_progress: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_security?: boolean;
          budget_alert?: boolean;
          created_at?: string;
          family_activity?: boolean;
          member_change?: boolean;
          monthly_summary?: boolean;
          savings_progress?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_security?: boolean;
          budget_alert?: boolean;
          created_at?: string;
          family_activity?: boolean;
          member_change?: boolean;
          monthly_summary?: boolean;
          savings_progress?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          channel: string;
          created_at: string;
          id: string;
          payload: Json | null;
          push_attempts: number;
          push_next_attempt_at: string | null;
          pushed_at: string | null;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          channel: string;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          push_attempts?: number;
          push_next_attempt_at?: string | null;
          pushed_at?: string | null;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          id?: string;
          payload?: Json | null;
          push_attempts?: number;
          push_next_attempt_at?: string | null;
          pushed_at?: string | null;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      password_login_attempts: {
        Row: {
          failed_attempts: number;
          locked_until: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          failed_attempts?: number;
          locked_until?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          failed_attempts?: number;
          locked_until?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          current_family_id: string | null;
          id: string;
          last_login_at: string | null;
          nickname: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          current_family_id?: string | null;
          id: string;
          last_login_at?: string | null;
          nickname: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          current_family_id?: string | null;
          id?: string;
          last_login_at?: string | null;
          nickname?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_current_family_id_fkey';
            columns: ['current_family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      recurring_runs: {
        Row: {
          created_at: string;
          id: string;
          period_key: string;
          rule_id: string;
          transaction_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          period_key: string;
          rule_id: string;
          transaction_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          period_key?: string;
          rule_id?: string;
          transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'recurring_runs_rule_id_fkey';
            columns: ['rule_id'];
            isOneToOne: false;
            referencedRelation: 'recurring_transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurring_runs_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      recurring_transactions: {
        Row: {
          amount: number;
          category_id: string;
          created_at: string;
          created_by: string;
          day_of_month: number;
          enabled: boolean;
          end_date: string | null;
          family_id: string;
          frequency: string;
          id: string;
          note: string | null;
          recorder_user_id: string;
          start_date: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          category_id: string;
          created_at?: string;
          created_by: string;
          day_of_month: number;
          enabled?: boolean;
          end_date?: string | null;
          family_id: string;
          frequency?: string;
          id?: string;
          note?: string | null;
          recorder_user_id: string;
          start_date: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category_id?: string;
          created_at?: string;
          created_by?: string;
          day_of_month?: number;
          enabled?: boolean;
          end_date?: string | null;
          family_id?: string;
          frequency?: string;
          id?: string;
          note?: string | null;
          recorder_user_id?: string;
          start_date?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recurring_transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurring_transactions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurring_transactions_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurring_transactions_recorder_user_id_fkey';
            columns: ['recorder_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      savings_entries: {
        Row: {
          amount: number;
          created_at: string;
          direction: string;
          goal_id: string;
          id: string;
          note: string | null;
          transaction_id: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          direction: string;
          goal_id: string;
          id?: string;
          note?: string | null;
          transaction_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          direction?: string;
          goal_id?: string;
          id?: string;
          note?: string | null;
          transaction_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'savings_entries_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'savings_goals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'savings_entries_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      savings_goals: {
        Row: {
          achieved_at: string | null;
          cover_url: string | null;
          created_at: string;
          deadline: string | null;
          family_id: string;
          id: string;
          name: string;
          note: string | null;
          saved_amount: number;
          status: string;
          target_amount: number;
          updated_at: string;
          version: number;
        };
        Insert: {
          achieved_at?: string | null;
          cover_url?: string | null;
          created_at?: string;
          deadline?: string | null;
          family_id: string;
          id?: string;
          name: string;
          note?: string | null;
          saved_amount?: number;
          status?: string;
          target_amount: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          achieved_at?: string | null;
          cover_url?: string | null;
          created_at?: string;
          deadline?: string | null;
          family_id?: string;
          id?: string;
          name?: string;
          note?: string | null;
          saved_amount?: number;
          status?: string;
          target_amount?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'savings_goals_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      succession_requests: {
        Row: {
          applicant_user_id: string;
          created_at: string;
          family_id: string;
          id: string;
          objection_deadline: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          applicant_user_id: string;
          created_at?: string;
          family_id: string;
          id?: string;
          objection_deadline: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          applicant_user_id?: string;
          created_at?: string;
          family_id?: string;
          id?: string;
          objection_deadline?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'succession_requests_applicant_user_id_fkey';
            columns: ['applicant_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'succession_requests_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
        ];
      };
      transactions: {
        Row: {
          amount: number;
          category_id: string;
          created_at: string;
          family_id: string;
          id: string;
          is_deleted: boolean;
          last_editor_user_id: string | null;
          note: string | null;
          occurred_at: string;
          recorder_user_id: string;
          savings_goal_id: string | null;
          source: string;
          sync_status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          category_id: string;
          created_at?: string;
          family_id: string;
          id?: string;
          is_deleted?: boolean;
          last_editor_user_id?: string | null;
          note?: string | null;
          occurred_at?: string;
          recorder_user_id: string;
          savings_goal_id?: string | null;
          source?: string;
          sync_status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category_id?: string;
          created_at?: string;
          family_id?: string;
          id?: string;
          is_deleted?: boolean;
          last_editor_user_id?: string | null;
          note?: string | null;
          occurred_at?: string;
          recorder_user_id?: string;
          savings_goal_id?: string | null;
          source?: string;
          sync_status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_last_editor_user_id_fkey';
            columns: ['last_editor_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_recorder_user_id_fkey';
            columns: ['recorder_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_savings_goal_id_fkey';
            columns: ['savings_goal_id'];
            isOneToOne: false;
            referencedRelation: 'savings_goals';
            referencedColumns: ['id'];
          },
        ];
      };
      verification_delivery_daily_limits: {
        Row: {
          channel: string;
          sent_count: number;
          sent_on: string;
          user_id: string;
        };
        Insert: {
          channel: string;
          sent_count?: number;
          sent_on: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          sent_count?: number;
          sent_on?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      consume_verification_delivery_quota: {
        Args: { p_channel: string; p_user_id: string };
        Returns: boolean;
      };
      create_family: {
        Args: { p_name: string; p_timezone: string };
        Returns: {
          avatar_url: string | null;
          cover_url: string | null;
          created_at: string;
          id: string;
          member_count: number;
          name: string;
          owner_user_id: string;
          slogan: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'families';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_invitation: {
        Args: { p_force_new?: boolean };
        Returns: {
          code: string;
          created_at: string;
          expires_at: string;
          family_id: string;
          id: string;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'invitations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_account: { Args: never; Returns: undefined };
      delete_savings_goal: { Args: { p_goal_id: string }; Returns: undefined };
      dissolve_family: { Args: never; Returns: undefined };
      emit_monthly_summary_notifications: { Args: never; Returns: number };
      generate_due_recurring_transactions: { Args: never; Returns: number };
      get_home_dashboard: {
        Args: { p_period: string };
        Returns: {
          balance_amount: number;
          budget_total_amount: number;
          budget_used_amount: number;
          expense_amount: number;
          family_id: string;
          income_amount: number;
          is_owner: boolean;
          transaction_count: number;
        }[];
      };
      get_budget_progress: {
        Args: { p_period: string };
        Returns: { category_usage: Json; used_amount: number }[];
      };
      get_family_activity: {
        Args: Record<PropertyKey, never>;
        Returns: {
          family_streak: number;
          latest_amount: number | null;
          latest_category_id: string | null;
          latest_recorder_user_id: string | null;
          latest_transaction_id: string | null;
          month_count: number;
          month_member_count: number;
          my_month_count: number;
          my_streak: number;
          today_count: number;
        }[];
      };
      get_monthly_summary: {
        Args: { p_period: string };
        Returns: {
          earliest_period: string | null;
          consumption_expense_amount: number;
          expense_amount: number;
          income_amount: number;
          max_expense_amount: number | null;
          max_expense_category_id: string | null;
          max_expense_id: string | null;
          max_expense_occurred_at: string | null;
          previous_expense_amount: number;
          previous_income_amount: number;
          top_category_amount: number | null;
          top_category_id: string | null;
          top_recorder_count: number | null;
          top_recorder_user_id: string | null;
          transaction_count: number;
        }[];
      };
      get_report_analytics: {
        Args: {
          p_category_ids?: string[];
          p_end: string;
          p_history_start: string;
          p_member_ids?: string[];
          p_previous_start: string;
          p_start: string;
        };
        Returns: Json;
      };
      get_report_category_detail: {
        Args: {
          p_category_ids: string[];
          p_cursor_id?: string | null;
          p_cursor_occurred_at?: string | null;
          p_end: string;
          p_history_start: string;
          p_page_size?: number;
          p_start: string;
        };
        Returns: Json;
      };
      search_transactions: {
        Args: {
          p_amount_max?: number | null;
          p_amount_min?: number | null;
          p_category_ids?: string[];
          p_cursor_id?: string | null;
          p_cursor_occurred_at?: string | null;
          p_custom_from?: string | null;
          p_custom_to?: string | null;
          p_date_preset?: string;
          p_keyword?: string;
          p_keyword_category_ids?: string[];
          p_keyword_recorder_ids?: string[];
          p_page_size?: number;
          p_recorder_ids?: string[];
          p_types?: string[];
        };
        Returns: Json;
      };
      join_family_by_code: {
        Args: { p_code: string };
        Returns: {
          avatar_url: string | null;
          cover_url: string | null;
          created_at: string;
          id: string;
          member_count: number;
          name: string;
          owner_user_id: string;
          slogan: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'families';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      leave_family: { Args: never; Returns: undefined };
      password_verification_attempt: { Args: { event: Json }; Returns: Json };
      preview_family_by_code: { Args: { p_code: string }; Returns: Json };
      register_device_token: {
        Args: {
          p_locale?: string;
          p_platform: string;
          p_provider?: string;
          p_token: string;
        };
        Returns: undefined;
      };
      remove_member: { Args: { p_user_id: string }; Returns: undefined };
      savings_deposit: {
        Args: {
          p_amount: number;
          p_expected_version: number;
          p_goal_id: string;
          p_note: string;
        };
        Returns: {
          achieved_at: string | null;
          cover_url: string | null;
          created_at: string;
          deadline: string | null;
          family_id: string;
          id: string;
          name: string;
          note: string | null;
          saved_amount: number;
          status: string;
          target_amount: number;
          updated_at: string;
          version: number;
        };
        SetofOptions: {
          from: '*';
          to: 'savings_goals';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      savings_withdraw: {
        Args: {
          p_amount: number;
          p_expected_version: number;
          p_goal_id: string;
          p_note: string;
        };
        Returns: {
          achieved_at: string | null;
          cover_url: string | null;
          created_at: string;
          deadline: string | null;
          family_id: string;
          id: string;
          name: string;
          note: string | null;
          saved_amount: number;
          status: string;
          target_amount: number;
          updated_at: string;
          version: number;
        };
        SetofOptions: {
          from: '*';
          to: 'savings_goals';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      submit_feedback: {
        Args: {
          p_contact_ok?: boolean;
          p_content: string;
          p_device?: Json;
          p_image_paths?: string[];
          p_type: string;
        };
        Returns: string;
      };
      transfer_ownership: {
        Args: { p_new_owner: string };
        Returns: {
          avatar_url: string | null;
          cover_url: string | null;
          created_at: string;
          id: string;
          member_count: number;
          name: string;
          owner_user_id: string;
          slogan: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'families';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      unregister_device_token: {
        Args: { p_token: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
